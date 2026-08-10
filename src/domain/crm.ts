/**
 * Org-level speaker CRM domain rules (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * Pure TypeScript: tag normalization, the directory's filter composition, the
 * contact activity feed, and the overview KPIs. Nothing here reads a
 * datastore — the D1 adapter applies the *same* directory predicate in SQL so
 * a large directory is narrowed by the database, and the functions below are
 * that predicate's reference form: what segment previews, in-memory lists and
 * the unit tests use.
 */
import type {
  ContactNote,
  EmailKind,
  EmailLog,
  EmailLogStatus,
  PipelineCard,
  PipelineStage,
  PipelineStageEvent,
} from "@/db/entities";
import type { DirectoryContact, DirectoryFilter } from "@/db/repos/contacts";
import { countCardsByStage } from "@/domain/pipeline";

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Longest tag an organizer can type; anything longer is a note, not a tag. */
export const TAG_MAX_LENGTH = 40;

/**
 * The one tag-normalization rule: trim, collapse inner whitespace, casefold.
 *
 * Tags are stored in this form, which is what makes the `contact_tags` primary
 * key ("one tag per contact per label") mean *per lowercased label* without an
 * expression index. Returns null when nothing survives, so callers have a
 * single check for "there is no tag here" rather than a mix of empty strings
 * and whitespace.
 */
export function normalizeTagLabel(raw: string | null | undefined): string | null {
  const normalized = (raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (normalized === "") return null;
  return normalized.slice(0, TAG_MAX_LENGTH);
}

/** Normalizes a list, dropping empties and duplicates, ascending. */
export function normalizeTagLabels(raw: readonly (string | null | undefined)[]): string[] {
  const labels = new Set<string>();
  for (const value of raw) {
    const label = normalizeTagLabel(value);
    if (label) labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Directory filtering
// ---------------------------------------------------------------------------

/**
 * The canonical form of a filter: trimmed, with blank fields dropped entirely.
 *
 * Every consumer normalizes before doing anything else, so `{ q: "  " }`, `{ q:
 * "" }` and `{}` are one filter with one serialization — otherwise two saved
 * segments that mean the same thing would compare unequal.
 */
export function normalizeDirectoryFilter(filter: DirectoryFilter | undefined): DirectoryFilter {
  const normalized: DirectoryFilter = {};
  const q = filter?.q?.trim();
  if (q) normalized.q = q;
  const company = filter?.company?.trim();
  if (company) normalized.company = company;
  const tag = normalizeTagLabel(filter?.tag);
  if (tag) normalized.tag = tag;
  return normalized;
}

/** True when the filter narrows nothing — the directory's default view. */
export function isEmptyDirectoryFilter(filter: DirectoryFilter | undefined): boolean {
  return Object.keys(normalizeDirectoryFilter(filter)).length === 0;
}

/** How many fields are actively narrowing; drives the "Clear filters" affordance. */
export function activeFilterCount(filter: DirectoryFilter | undefined): number {
  return Object.keys(normalizeDirectoryFilter(filter)).length;
}

function containsFold(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}

/**
 * The directory predicate: search, company and tag all ANDed, each one a
 * wildcard when absent.
 *
 * Search covers name and email — the two things an organizer types when
 * hunting for a person. Company is its own filter rather than part of the
 * search box because the top-companies widget links straight into it, and a
 * company that also appears in someone's title must not smear the result.
 */
export function matchesDirectoryFilter(
  contact: DirectoryContact,
  filter: DirectoryFilter | undefined,
): boolean {
  const { q, company, tag } = normalizeDirectoryFilter(filter);
  if (q && !containsFold(contact.name, q) && !containsFold(contact.email, q)) return false;
  if (company && !containsFold(contact.company, company)) return false;
  if (tag && !contact.tags.includes(tag)) return false;
  return true;
}

/** The whole directory narrowed in one call — the segment preview's engine. */
export function filterDirectory(
  contacts: readonly DirectoryContact[],
  filter: DirectoryFilter | undefined,
): DirectoryContact[] {
  return contacts.filter((contact) => matchesDirectoryFilter(contact, filter));
}

/** A contact's display name: their name, or the address we know them by. */
export function contactDisplayName(
  contact: Pick<DirectoryContact, "name" | "email">,
): string {
  return contact.name?.trim() || contact.email;
}

/**
 * Directory order: display name, case-insensitively, with the email as the
 * tie-break so the list is stable across reads (two unnamed contacts at the
 * same company would otherwise shuffle between page loads).
 */
export function sortDirectoryContacts(
  contacts: readonly DirectoryContact[],
): DirectoryContact[] {
  return [...contacts].sort((a, b) => {
    const byName = contactDisplayName(a)
      .toLowerCase()
      .localeCompare(contactDisplayName(b).toLowerCase());
    return byName !== 0 ? byName : a.email.localeCompare(b.email);
  });
}

/**
 * Whether creating a new contact named `name` would collide with an existing
 * directory contact's display name (decisions.md D-059's duplicate flag,
 * checked *before* the new row is written rather than only surfacing on the
 * list afterward). Returns the colliding contact's email for the flash
 * message, or null when nothing collides.
 *
 * Name-only: a shared email is a different, stricter case (same identity,
 * decisions.md D-051) handled separately by the caller before this ever runs.
 */
export function findDisplayNameCollision(
  contacts: readonly DirectoryContact[],
  name: string,
): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const match = contacts.find((contact) => contactDisplayName(contact).toLowerCase() === key);
  return match ? match.email : null;
}

// ---------------------------------------------------------------------------
// Contact activity feed
// ---------------------------------------------------------------------------

/**
 * One entry on a contact's activity feed. A discriminated union rather than a
 * lowest-common-denominator row: each kind carries exactly what its renderer
 * needs, and adding a fourth kind later is a compile error at every switch.
 */
export type ContactActivityItem =
  | {
      kind: "email";
      id: string;
      at: Date;
      subject: string;
      emailKind: EmailKind;
      status: EmailLogStatus;
    }
  | {
      kind: "stage";
      id: string;
      at: Date;
      /** Null on the enrol event. */
      from: PipelineStage | null;
      to: PipelineStage;
      actorUserId: string | null;
    }
  | {
      kind: "note";
      id: string;
      at: Date;
      body: string;
      authorUserId: string | null;
    };

export interface ContactActivityInput {
  /** Sends to this contact's address (`EmailLogRepo.listByRecipient`, D-065). */
  emails?: readonly EmailLog[];
  /** Their card's stage history, if they are enrolled. */
  stageEvents?: readonly PipelineStageEvent[];
  /** Org-level internal notes. */
  notes?: readonly ContactNote[];
}

/**
 * Merges the three activity sources into one newest-first feed.
 *
 * Ties are broken by kind and then id rather than left to sort stability: two
 * things logged in the same second (an enrol and its first email, say) must
 * come back in the same order on every read, or the feed appears to reshuffle
 * itself when nothing has changed.
 */
export function buildContactActivity(input: ContactActivityInput): ContactActivityItem[] {
  const items: ContactActivityItem[] = [
    ...(input.emails ?? []).map<ContactActivityItem>((email) => ({
      kind: "email",
      id: email.id,
      at: email.sentAt,
      subject: email.subject,
      emailKind: email.kind,
      status: email.status,
    })),
    ...(input.stageEvents ?? []).map<ContactActivityItem>((event) => ({
      kind: "stage",
      id: event.id,
      at: event.createdAt,
      from: event.fromStage,
      to: event.toStage,
      actorUserId: event.actorUserId,
    })),
    ...(input.notes ?? []).map<ContactActivityItem>((note) => ({
      kind: "note",
      id: note.id,
      at: note.createdAt,
      body: note.body,
      authorUserId: note.authorUserId,
    })),
  ];

  return items.sort((a, b) => {
    const byTime = b.at.getTime() - a.at.getTime();
    if (byTime !== 0) return byTime;
    return a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Overview KPIs (spec.md: org-wide KPIs + top companies)
// ---------------------------------------------------------------------------

/** How many companies the overview widget shows. */
export const TOP_COMPANIES_LIMIT = 5;

export interface CompanyCount {
  company: string;
  count: number;
}

/**
 * The most-represented companies, count descending and ties broken
 * alphabetically so the widget is deterministic.
 *
 * Companies are grouped case-insensitively but *displayed* using the first
 * spelling encountered in directory order, because "Northwind" and "northwind"
 * are one employer and splitting them would understate both. Contacts with no
 * company are counted nowhere — "(none)" is not a company an organizer can
 * click through to.
 */
export function topCompanies(
  contacts: readonly DirectoryContact[],
  limit: number = TOP_COMPANIES_LIMIT,
): CompanyCount[] {
  const counts = new Map<string, CompanyCount>();
  for (const contact of contacts) {
    const company = contact.company?.trim();
    if (!company) continue;
    const key = company.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { company, count: 1 });
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company))
    .slice(0, Math.max(0, limit));
}

export interface CrmKpis {
  /** Everyone in the directory: speakers plus registered contacts. */
  totalContacts: number;
  /** Events in the organization — the denominator of "across events". */
  totalEvents: number;
  /** Contacts connected to two or more events (spec.md: returning speakers). */
  returningSpeakers: number;
  /** Card counts per stage, every stage present including zeros. */
  pipelineByStage: Record<PipelineStage, number>;
  /** Contacts with a card on the board, whatever stage. */
  pipelineTotal: number;
  topCompanies: CompanyCount[];
}

export interface CrmKpiInput {
  contacts: readonly DirectoryContact[];
  /** `events.listAll().length` — counted, not derived from the directory, so
   * an event with no speakers yet still shows up. */
  totalEvents: number;
  cards: readonly PipelineCard[];
}

/** Everything the CRM overview renders, from three cheap reads. */
export function computeCrmKpis(input: CrmKpiInput): CrmKpis {
  return {
    totalContacts: input.contacts.length,
    totalEvents: input.totalEvents,
    returningSpeakers: input.contacts.filter((contact) => contact.eventCount >= 2).length,
    pipelineByStage: countCardsByStage(input.cards),
    pipelineTotal: input.cards.length,
    topCompanies: topCompanies(input.contacts),
  };
}
