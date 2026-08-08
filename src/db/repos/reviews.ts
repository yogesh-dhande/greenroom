import type { NewReview, Review } from "@/db/entities";

/**
 * Optional reviewer scores/comments (spec.md "Useful enhancements"). The
 * binding accept/maybe/deny decision lives on the submission itself, so
 * nothing in the core flow depends on this table.
 */
export interface ReviewsRepo {
  getById(id: string): Promise<Review | null>;
  listBySubmission(submissionId: string): Promise<Review[]>;
  listByReviewer(reviewerId: string): Promise<Review[]>;
  getByReviewer(submissionId: string, reviewerId: string): Promise<Review | null>;
  create(input: NewReview): Promise<Review>;
  update(id: string, patch: Partial<NewReview>): Promise<Review>;
  delete(id: string): Promise<void>;
}
