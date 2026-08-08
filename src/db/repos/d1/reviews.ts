import { and, eq } from "drizzle-orm";
import { reviewSchema, type NewReview } from "@/db/entities";
import { reviews } from "@/db/schema";
import type { ReviewsRepo } from "@/db/repos/reviews";
import type { DrizzleD1 } from "./client";

export function createReviewsRepo(db: DrizzleD1): ReviewsRepo {
  return {
    async getById(id) {
      const row = await db.query.reviews.findFirst({ where: eq(reviews.id, id) });
      return row ? reviewSchema.parse(row) : null;
    },
    async listBySubmission(submissionId) {
      const rows = await db.query.reviews.findMany({
        where: eq(reviews.submissionId, submissionId),
      });
      return rows.map((r) => reviewSchema.parse(r));
    },
    async listBySubmissionAndRound(submissionId, round) {
      const rows = await db.query.reviews.findMany({
        where: and(eq(reviews.submissionId, submissionId), eq(reviews.round, round)),
      });
      return rows.map((r) => reviewSchema.parse(r));
    },
    async listByReviewer(reviewerId) {
      const rows = await db.query.reviews.findMany({
        where: eq(reviews.reviewerId, reviewerId),
      });
      return rows.map((r) => reviewSchema.parse(r));
    },
    async create(input: NewReview) {
      const [row] = await db.insert(reviews).values(input).returning();
      return reviewSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(reviews)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(reviews.id, id))
        .returning();
      return reviewSchema.parse(row);
    },
    async delete(id) {
      await db.delete(reviews).where(eq(reviews.id, id));
    },
  };
}
