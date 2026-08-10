/**
 * The pure half of the shared "choose people" pattern: substring search over
 * a list, one-click groups with live tallies, and the count the summary
 * beside the send button promises.
 *
 * It lives apart from the component, and free of React, because these are the
 * parts that can quietly be wrong — which rows a query matches, which chip is
 * currently on, how many people a send will actually reach — and they're
 * cheaper to test than to click through.
 */

/** Anyone a picker can offer; search reads name, email and company. */
export interface PersonOption {
  id: string;
  /** What the row leads with — a name, or the address when that's all we know. */
  name: string;
  email: string;
  company?: string | null;
  /** A short badge beside the name, e.g. "On the program". */
  note?: string | null;
}

/**
 * A one-click group, declared as a predicate over the caller's own rows so
 * every surface can name its own groups ("Not confirmed", "Unassigned") from
 * data it already holds, without this module knowing what those mean.
 */
export interface GroupDefinition<T> {
  id: string;
  label: string;
  matches: (item: T) => boolean;
  /** Attention groups take the semantic `warning` pair (decisions.md D-018);
   * everything else is neutral. */
  tone?: GroupTone;
}

export type GroupTone = "default" | "warning";

/** A group resolved against the current rows: who's in it, and how many. */
export interface PickerGroup {
  id: string;
  label: string;
  /** Exactly what clicking the chip selects. */
  ids: string[];
  tone: GroupTone;
}

/**
 * Words for `selectionSummary` — every surface says what it's about to do in
 * its own nouns ("Going to 12 people", "Assigning 4 submissions").
 */
export interface SummaryWords {
  lead?: string;
  singular?: string;
  plural?: string;
  empty?: string;
}

/**
 * Whitespace-separated search terms, lowercased. Splitting means "priya ex"
 * finds Priya at example.com — an organizer types the two things they
 * remember, in either order, and doesn't have to reproduce one exact
 * substring of one field.
 */
export function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every term appears somewhere in these fields, case-insensitively. */
export function matchesQuery(fields: Array<string | null | undefined>, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** Narrows any list by a search box, given which of its fields are searchable. */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => Array<string | null | undefined>,
): T[] {
  if (queryTokens(query).length === 0) return [...items];
  return items.filter((item) => matchesQuery(fields(item), query));
}

/** The searchable fields of a person, in the order they're displayed. */
export function personFields(person: PersonOption): Array<string | null | undefined> {
  return [person.name, person.email, person.company];
}

export function filterPeople<T extends PersonOption>(people: readonly T[], query: string): T[] {
  return filterByQuery(people, query, personFields);
}

/**
 * Resolves group definitions against the current rows.
 *
 * Empty groups are dropped rather than rendered at zero: a chip that selects
 * nobody is a dead control, and "Behind on tasks 0" reads as a problem when
 * it's actually the happy case the tallies elsewhere already show.
 */
export function buildGroups<T extends { id: string }>(
  items: readonly T[],
  definitions: readonly GroupDefinition<T>[],
): PickerGroup[] {
  return definitions
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
      tone: definition.tone ?? ("default" as const),
      ids: items.filter((item) => definition.matches(item)).map((item) => item.id),
    }))
    .filter((group) => group.ids.length > 0);
}

/** Same members, order and duplicates aside. */
export function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}

/**
 * Which chip is currently on — the one whose members are exactly the current
 * selection. Tick one box afterwards and no chip is pressed any more, which
 * is the honest reading: the selection is no longer "the speakers behind on
 * tasks", it's a hand-edited list.
 */
export function activeGroupId(
  groups: readonly PickerGroup[],
  selected: readonly string[],
): string | null {
  if (selected.length === 0) return null;
  return groups.find((group) => sameSelection(group.ids, selected))?.id ?? null;
}

/** Adds or removes one id, preserving the rest of the selection's order. */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((other) => other !== id)
    : [...selected, id];
}

/**
 * Where a single-choice list stops being scannable and earns a filter box.
 *
 * Single-select pickers (a task, an event, a contact to enrol) keep their
 * native/Radix select — it's one choice, and a select is the right control for
 * one choice — but past a screenful of options, finding the one you mean by
 * eye stops working. Above this count those surfaces put the same search box
 * over their options; below it, an extra input would be furniture.
 */
export const LONG_LIST_THRESHOLD = 8;

export function isLongList(count: number): boolean {
  return count > LONG_LIST_THRESHOLD;
}

/** "Going to 12 people" — the sentence beside the button. */
export function selectionSummary(count: number, words: SummaryWords = {}): string {
  const {
    lead = "Going to",
    singular = "person",
    plural = "people",
    empty = "Nobody picked yet",
  } = words;
  if (count === 0) return empty;
  return `${lead} ${count} ${count === 1 ? singular : plural}`;
}
