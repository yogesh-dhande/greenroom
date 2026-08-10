import type { SubmissionStatus } from "@/db/entities";

/**
 * Filter vocabulary for the review queue, in its own module so the client
 * filter bar can import it without dragging the server-only queue loader
 * (and, through it, the email transport) into the browser bundle.
 */

export const ALL = "all";

/** Status choices, in decision-flow order. Labels match the status badge —
 * `submitted` reads as "Unreviewed" to an organizer (spec.md §4). */
export const STATUS_FILTERS: Array<{ value: SubmissionStatus; label: string }> = [
  { value: "submitted", label: "Unreviewed" },
  { value: "approved", label: "Approved" },
  { value: "maybe", label: "Maybe" },
  { value: "denied", label: "Denied" },
  { value: "draft", label: "Draft" },
  { value: "withdrawn", label: "Withdrawn" },
];

export interface QueueFilter {
  status: string;
  track: string;
  /** Free-text search, matched against title and speaker name - the queue's
   * triage-bar search box (spec.md section 4, wave W25). Empty matches everything. */
  q: string;
}
