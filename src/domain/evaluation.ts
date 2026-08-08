/**
 * Evaluation domain service — score aggregation, ranking, and accept/
 * reject/waitlist decisions (spec.md §4). Pure TypeScript: no datastore
 * imports. Callers (route handlers/server actions) fetch Review/Submission
 * rows via src/db/repos/* and pass plain entities in.
 */
import type { Review, Submission, SubmissionStatus } from "@/db/entities";

export interface CriteriaAverage {
  criterion: string;
  average: number;
  count: number;
}

export interface SubmissionScoreSummary {
  submissionId: string;
  overallAverage: number;
  reviewCount: number;
  byCriteria: CriteriaAverage[];
}

/**
 * Aggregates one round's reviews for a single submission into per-criteria
 * and overall averages, for the reviewer dashboard's "aggregate views"
 * (spec.md §4).
 */
export function summarizeScores(
  submissionId: string,
  reviews: Review[],
): SubmissionScoreSummary {
  // TODO: average `scores` (JSON, keyed by criteria id) across `reviews`,
  // per criterion and overall. Reviews from different rounds should likely
  // be summarized separately by the caller (pass one round's reviews at a
  // time) so screening-round noise doesn't dilute the final round.
  return {
    submissionId,
    overallAverage: 0,
    reviewCount: reviews.length,
    byCriteria: [],
  };
}

export interface RankedSubmission {
  submission: Submission;
  summary: SubmissionScoreSummary;
  rank: number;
}

/** Ranks a category/track's submissions by aggregate score, for the
 * organizer's accept/reject/waitlist workflow (spec.md §4). */
export function rankSubmissions(
  submissions: Submission[],
  reviewsBySubmissionId: Map<string, Review[]>,
): RankedSubmission[] {
  // TODO: compute a SubmissionScoreSummary per submission and sort
  // descending by overallAverage, assigning `rank` 1..n.
  return [];
}

/**
 * Applies an organizer's accept/reject/waitlist decision. Accepting a
 * submission is the trigger into onboarding (spec.md §4 "Decision triggers
 * downstream state") — the caller is responsible for creating the
 * speaker's task assignments (src/domain/onboarding.ts) after this returns.
 */
export function decideOutcome(
  submission: Submission,
  decision: Extract<SubmissionStatus, "accepted" | "rejected" | "waitlisted">,
): Pick<Submission, "status"> {
  // TODO: validate the submission is in a decidable state (e.g.
  // "under_review") before allowing the transition.
  return { status: decision };
}
