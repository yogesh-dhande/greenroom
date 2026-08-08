import type { NewReview, Review } from "@/db/entities";

export interface ReviewsRepo {
  getById(id: string): Promise<Review | null>;
  /** All reviews for a submission across rounds — used for score aggregation
   * (src/domain/evaluation.ts). Callers enforcing "reviewers can't see other
   * reviewers' scores mid-round" (spec.md Roles) must filter/authorize
   * before rendering, not rely on the repo to do it. */
  listBySubmission(submissionId: string): Promise<Review[]>;
  listBySubmissionAndRound(submissionId: string, round: number): Promise<Review[]>;
  listByReviewer(reviewerId: string): Promise<Review[]>;
  create(input: NewReview): Promise<Review>;
  update(id: string, patch: Partial<NewReview>): Promise<Review>;
  delete(id: string): Promise<void>;
}
