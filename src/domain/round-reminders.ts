/**
 * Reviewer completion nudges (decisions.md D-050).
 *
 * Pure TypeScript — no datastore imports. A thin wrapper around
 * `progressByReviewer` (src/domain/rounds.ts): rather than recomputing "who
 * still owes scorecards" from scratch, this filters that same per-reviewer
 * progress so the reminder can never disagree with what the assignments
 * page's own Progress column already shows.
 */
import type { RoundAssignment } from "@/db/entities";
import { progressByReviewer, type ReviewerProgress } from "@/domain/rounds";

/** A reviewer with at least one unfiled scorecard in the round. */
export type PendingReviewer = ReviewerProgress;

/**
 * Reviewers in this round who still have unfiled scorecards, in no
 * particular order (the caller resolves and sorts recipients as needed).
 * Recused assignments never count — `progressByReviewer` already excludes
 * them from `required`, so a reviewer who recused from everything they were
 * given has `pending: 0` and is left out here.
 */
export function pendingReviewers(
  assignments: Array<Pick<RoundAssignment, "id" | "reviewerId" | "status">>,
  scoredAssignmentIds: ReadonlySet<string>,
): PendingReviewer[] {
  return progressByReviewer(assignments, scoredAssignmentIds).filter(
    (progress) => progress.pending > 0,
  );
}

/** "1 scorecard" / "3 scorecards" — the reminder email's own count phrase. */
export function pendingScorecardsLabel(pending: number): string {
  return `${pending} scorecard${pending === 1 ? "" : "s"}`;
}
