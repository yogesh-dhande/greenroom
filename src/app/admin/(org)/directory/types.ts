/**
 * Serializable view models the directory's server components hand to their
 * client islands (spec.md "Org-level speaker CRM", decisions.md D-077).
 *
 * Dependency-free at runtime, for the same reason as
 * src/app/admin/[eventSlug]/communications/types.ts: every import here is
 * `import type`, so nothing a `"use client"` file pulls in through this
 * module can drag the repository layer or the email transport into the
 * browser bundle (learnings.md, "A `use client` import chain can pull the
 * email transport into the browser bundle").
 *
 * Dates are pre-formatted on the server rather than crossing as `Date`s: an
 * org-level page has no event timezone to format in, so the server's answer
 * is the only answer, and formatting it twice would be a hydration mismatch.
 */
import type { DirectoryFilter } from "@/db/repos/contacts";

/** One row of the directory table, already resolved for display. */
export interface DirectoryRow {
  userId: string;
  /** Name, or the address when we only know them by that. */
  displayName: string;
  name: string | null;
  email: string;
  title: string | null;
  company: string | null;
  tags: string[];
  eventCount: number;
  /** "Contacted", or null when they aren't on the sourcing board. */
  stageLabel: string | null;
  /** True when another directory contact shares this display name (D-059). */
  duplicate: boolean;
  /** "Also: ada@example.com" — who the collision is with, for the badge title. */
  duplicateWith: string;
}

/** A saved segment as the directory lists it. */
export interface SegmentRow {
  id: string;
  name: string;
  /** "Company contains Northwind - tag ai" — the criteria in plain words. */
  criteria: string;
  /** Contacts matching it right now; a segment is dynamic, so this is a
   * count taken at render time, never a stored membership list. */
  memberCount: number;
}

/** A recipient of a bulk send. */
export interface RecipientOption {
  userId: string;
  name: string | null;
  email: string;
  displayName: string;
}

/** An event the "Add to event" picker can target. */
export interface EventOption {
  id: string;
  slug: string;
  name: string;
  /** "Aug 8 - Aug 10, 2026", or "Dates TBD". */
  dates: string;
  /** Already connected to this contact — offered, but not selectable. */
  connected: boolean;
}

/** The current directory narrowing, as the filter bar and Save segment see it. */
export type DirectoryFilterValues = Required<{
  [K in keyof DirectoryFilter]: string;
}>;
