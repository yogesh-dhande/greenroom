"use client";

import * as React from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  activeGroupId,
  buildGroups,
  filterPeople,
  selectionSummary,
  toggleSelection,
  type GroupDefinition,
  type PersonOption,
  type PickerGroup,
  type SummaryWords,
} from "./selection";

/**
 * The shared "choose people" surface: search the list, click a group, see
 * exactly who's going.
 *
 * Every picker in the admin answers the same three questions — who is there,
 * who do I usually want, and who did I just pick — so they answer them the
 * same way rather than each inventing a checkbox list. The parts are exported
 * separately (`PickerSearch`, `GroupChips`, `SelectionSummary`) because some
 * surfaces choose sessions or submissions rather than people and only need
 * one or two of them.
 *
 * Colour comes from the semantic token set only, with attention groups on the
 * `warning` pair (decisions.md D-018).
 */

/** A labelled search box over a list that's already on screen. */
export function PickerSearch({
  value,
  onValueChange,
  label,
  placeholder = "Name, email, or company",
  id,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** The accessible name — "Search recipients", not just "Search". */
  label: string;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  return (
    <Input
      type="search"
      id={id}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      aria-label={label}
      placeholder={placeholder}
      className={className}
    />
  );
}

/**
 * One-click groups with live tallies.
 *
 * Each chip is a real toggle button reporting `aria-pressed`, and pressing one
 * selects *exactly* its members — no accumulation, so the tally on the chip
 * and the count in the summary can never disagree. Pressing the chip that's
 * already on clears the selection, which is how a toggle is expected to
 * behave.
 */
export function GroupChips({
  groups,
  selected,
  onSelectedChange,
  label,
  className,
}: {
  groups: PickerGroup[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  /** Accessible name for the chip row, e.g. "Recipient groups". */
  label: string;
  className?: string;
}) {
  const active = activeGroupId(groups, selected);
  if (groups.length === 0) return null;

  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {groups.map((group) => {
        const pressed = group.id === active;
        return (
          <button
            key={group.id}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelectedChange(pressed ? [] : group.ids)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-4xl border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              pressed
                ? "border-transparent bg-primary text-primary-foreground"
                : group.tone === "warning"
                  ? "border-warning/40 text-warning hover:bg-warning/10"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {group.label}
            <span className="tabular-nums opacity-70">{group.ids.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Going to 12 people", expanding to the names.
 *
 * A native `<details>` disclosure: the answer sits collapsed next to the
 * button that acts on it, and checking it costs one click rather than a
 * scroll back up the list — which is where the wrong-recipient mistake
 * actually gets caught.
 */
export function SelectionSummary({
  names,
  words,
  className,
}: {
  /** Display names of everything currently selected, in list order. */
  names: string[];
  words?: SummaryWords;
  className?: string;
}) {
  const label = selectionSummary(names.length, words);

  if (names.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{label}</p>;
  }

  return (
    <details
      className={cn(
        "group/summary min-w-0 rounded-lg border border-border px-3 py-1.5 text-sm",
        className,
      )}
    >
      <summary className="cursor-pointer list-none font-medium text-foreground marker:content-['']">
        {label}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          <span className="group-open/summary:hidden">show</span>
          <span className="hidden group-open/summary:inline">hide</span>
        </span>
      </summary>
      <ul className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto pb-1">
        {names.map((name, index) => (
          <li key={`${name}-${index}`} className="truncate text-sm text-muted-foreground">
            {name}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Search + group chips + checkbox list over one set of people.
 *
 * Selection is owned by the caller: the ids it holds are the ids its server
 * action sends, and this component never filters them — narrowing the search
 * hides rows, it doesn't quietly drop anyone already ticked. The "showing N
 * of M" line says so out loud whenever a query is active.
 */
export function PeoplePicker<T extends PersonOption>({
  people,
  selected,
  onSelectedChange,
  groups = [],
  heading,
  searchLabel,
  searchPlaceholder,
  groupsLabel,
  emptyMessage,
  listClassName,
  className,
}: {
  people: T[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  /** One-click groups, as predicates over the caller's own rows. */
  groups?: Array<GroupDefinition<T>>;
  /** Heading above the list — pass a count in it where one is useful. */
  heading: React.ReactNode;
  /** Accessible name for the search box, e.g. "Search recipients". */
  searchLabel: string;
  searchPlaceholder?: string;
  groupsLabel?: string;
  /** Shown instead of the list when there's nobody at all to pick from. */
  emptyMessage: React.ReactNode;
  listClassName?: string;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");

  const resolvedGroups = React.useMemo(() => buildGroups(people, groups), [people, groups]);
  const shown = React.useMemo(() => filterPeople(people, query), [people, query]);
  const searching = query.trim().length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm leading-none font-medium text-foreground">{heading}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelectedChange([])}
          disabled={selected.length === 0}
        >
          Clear
        </Button>
      </div>

      {people.length === 0 ? (
        <div className="text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <>
          <PickerSearch
            value={query}
            onValueChange={setQuery}
            label={searchLabel}
            placeholder={searchPlaceholder}
          />

          <GroupChips
            groups={resolvedGroups}
            selected={selected}
            onSelectedChange={onSelectedChange}
            label={groupsLabel ?? "Groups"}
          />

          {shown.length === 0 ? (
            <EmptyState
              variant="inline"
              title={`Nobody here matches “${query.trim()}”.`}
              action={
                <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <ul
              className={cn(
                "flex max-h-[28rem] flex-col gap-1 overflow-y-auto rounded-md border border-border p-2",
                listClassName,
              )}
            >
              {shown.map((person) => (
                <li key={person.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted">
                    <Checkbox
                      checked={selected.includes(person.id)}
                      onCheckedChange={() =>
                        onSelectedChange(toggleSelection(selected, person.id))
                      }
                      className="mt-0.5"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <span className="truncate">{person.name}</span>
                        {person.note ? (
                          <Badge variant="outline" className="shrink-0">
                            {person.note}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[person.email, person.company].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {searching ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {shown.length} of {people.length}
              {selected.length > 0 ? ` · ${selected.length} picked in total` : ""}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
