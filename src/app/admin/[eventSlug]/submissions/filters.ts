import type { SubmissionStatus } from "@/db/entities";

/**
 * Filter vocabulary for the review queue, in its own module so the client
 * filter bar can import it without dragging the server-only queue loader
 * (and, through it, the email transport) into the browser bundle.
 */

export const ALL = "all";

/**
 * The URL parameter carrying which list a reviewer is looking at — their
 * assignments or every talk in their tracks (decisions.md D-066). It lives
 * beside the filters because it survives them: narrowing by status or clearing
 * the filter bar must not move a reviewer to the other list.
 */
export const VIEW_PARAM = "view";

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
