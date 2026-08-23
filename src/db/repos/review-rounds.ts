import type {
  NewReviewRound,
  ReviewRound,
  RoundAssignment,
  RoundAssignmentStatus,
  RoundScore,
} from "@/db/entities";

/**
 * Multi-round scored evaluations (spec.md "Important", decisions.md D-031).
 *
 * One repo covers the round and its two dependent tables — the same shape as
 * SubmissionsRepo owning its track/speaker joins: an assignment or a score
 * only exists inside a round, and every read the app needs starts from one.
 */
export interface ReviewRoundsRepo {
  getById(id: string): Promise<ReviewRound | null>;
  listByEvent(eventId: string): Promise<ReviewRound[]>;
  create(input: NewReviewRound): Promise<ReviewRound>;
  update(id: string, patch: Partial<NewReviewRound>): Promise<ReviewRound>;
  delete(id: string): Promise<void>;

  // --- assignments (who reviews what, per round) ---
  getAssignment(id: string): Promise<RoundAssignment | null>;
  listAssignments(roundId: string): Promise<RoundAssignment[]>;
  /** Batch variant: the rounds list shows progress per row. */
  listAssignmentsByRounds(roundIds: string[]): Promise<RoundAssignment[]>;
  /**
   * Every assignment this person holds, across rounds. The reviewer's queue is
   * built from this — never from the round's full submission list — so scoping
   * is a property of the query, not of the page that renders it.
   */
  listAssignmentsByReviewer(reviewerId: string): Promise<RoundAssignment[]>;
  /** The one assignment that authorises a reviewer to score a submission. */
  findAssignment(
    roundId: string,
    submissionId: string,
    reviewerId: string,
  ): Promise<RoundAssignment | null>;
  /** Idempotent: assigning the same work twice returns the existing row. */
  assign(roundId: string, submissionId: string, reviewerId: string): Promise<RoundAssignment>;
  unassign(id: string): Promise<void>;
  /**
   * Removes an assignment only if no scorecard has been filed against it,
   * reporting whether it did.
   *
   * A read-then-delete cannot express this safely: `round_scores.assignment_id`
   * is `ON DELETE cascade`, so a scorecard submitted between the check and the
   * delete is destroyed by it (decisions.md D-095). The condition has to travel
   * with the delete, which is why this is a repo method and not a guard the
   * caller assembles.
   */
  unassignIfUnscored(id: string): Promise<boolean>;
  setAssignmentStatus(
    id: string,
    status: RoundAssignmentStatus,
    recusalReason?: string | null,
  ): Promise<RoundAssignment>;

  // --- submitted scorecards ---
  getScore(assignmentId: string): Promise<RoundScore | null>;
  listScoresByAssignments(assignmentIds: string[]): Promise<RoundScore[]>;
  /** Upsert: a reviewer revising their scorecard replaces it. */
  saveScore(
    assignmentId: string,
    values: Record<string, unknown>,
    submittedAt: Date,
  ): Promise<RoundScore>;
}
