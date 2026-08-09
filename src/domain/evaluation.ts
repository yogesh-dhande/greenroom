/**
 * Evaluation domain service — the approve / maybe / deny decision flow
 * (spec.md §4) and optional score aggregation (enhancement tier). Pure
 * TypeScript: no datastore imports. Callers (route handlers/server actions)
 * fetch Review/Submission rows via src/db/repos/* and pass plain entities in.
 */
import type { Review, Submission, SubmissionDecision, SubmissionStatus } from "@/db/entities";

// ---------------------------------------------------------------------------
// Decisions (required MVP flow)
// ---------------------------------------------------------------------------

/** Statuses a decision may be recorded against: an unreviewed submission,
 * or one already decided (organizers do change their minds). */
const DECIDABLE_STATUSES = new Set(["submitted", "approved", "maybe", "denied"]);

export function canDecide(submission: Submission): boolean {
  return DECIDABLE_STATUSES.has(submission.status);
}

/** The fields a decision writes onto the submission. */
export type DecisionPatch = Pick<
  Submission,
  "status" | "decidedBy" | "decidedAt" | "decisionNote"
>;

/**
 * Records a reviewer's or admin's decision (spec.md §4:
 * `unreviewed -> approve / maybe / deny`). Approving is the trigger into
 * onboarding — the caller creates the speaker/session/task records
 * afterwards (src/domain/onboarding.ts), which is why this returns a patch
 * rather than persisting anything itself.
 */
export function decide(
  submission: Submission,
  decision: SubmissionDecision,
  decidedBy: string,
  options: { note?: string | null; now?: Date } = {},
): DecisionPatch {
  if (!canDecide(submission)) {
    throw new Error(
      `Submission ${submission.id} is "${submission.status}" and cannot be decided.`,
    );
  }
  return {
    status: decision,
    decidedBy,
    decidedAt: options.now ?? new Date(),
    decisionNote: options.note ?? submission.decisionNote,
  };
}

/**
 * What a speaker is shown for their own submission's status (decisions.md
 * D-028: a waitlist decision changes nothing the speaker sees — Sessionboard
 * renders queue statuses to speakers as a generic pending icon and never
 * auto-emails on status change). A "maybe" reads back to the speaker as
 * still-submitted; every other status passes through unchanged. Admin/reviewer
 * views must NOT use this — they use the real status.
 */
export function speakerFacingStatus(status: SubmissionStatus): SubmissionStatus {
  return status === "maybe" ? "submitted" : status;
}

// ---------------------------------------------------------------------------
// Scores (enhancement tier — optional, never required by the core flow)
// ---------------------------------------------------------------------------

export interface SubmissionScoreSummary {
  submissionId: string;
  /** Null when no reviewer recorded a numeric score. */
  averageScore: number | null;
  reviewCount: number;
  /** Tally of non-binding reviewer recommendations. */
  recommendations: { approve: number; maybe: number; deny: number };
}

export function summarizeReviews(
  submissionId: string,
  reviews: Review[],
): SubmissionScoreSummary {
  const scores = reviews
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");
  const recommendations = { approve: 0, maybe: 0, deny: 0 };
  for (const review of reviews) {
    if (review.recommendation) recommendations[review.recommendation] += 1;
  }
  return {
    submissionId,
    averageScore:
      scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length,
    reviewCount: reviews.length,
    recommendations,
  };
}
