import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import {
  reviewRoundSchema,
  roundAssignmentSchema,
  roundScoreSchema,
  type NewReviewRound,
} from "@/db/entities";
import { reviewRounds, roundAssignments, roundScores } from "@/db/schema";
import type { ReviewRoundsRepo } from "@/db/repos/review-rounds";
import type { DrizzleD1 } from "./client";

export function createReviewRoundsRepo(db: DrizzleD1): ReviewRoundsRepo {
  return {
    async getById(id) {
      const row = await db.query.reviewRounds.findFirst({ where: eq(reviewRounds.id, id) });
      return row ? reviewRoundSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.reviewRounds.findMany({
        where: eq(reviewRounds.eventId, eventId),
        // Chronological: an organizer reads their plan in the order it runs.
        orderBy: [asc(reviewRounds.opensAt), asc(reviewRounds.createdAt)],
      });
      return rows.map((r) => reviewRoundSchema.parse(r));
    },
    async create(input: NewReviewRound) {
      const [row] = await db.insert(reviewRounds).values(input).returning();
      return reviewRoundSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(reviewRounds)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(reviewRounds.id, id))
        .returning();
      return reviewRoundSchema.parse(row);
    },
    async delete(id) {
      await db.delete(reviewRounds).where(eq(reviewRounds.id, id));
    },

    async getAssignment(id) {
      const row = await db.query.roundAssignments.findFirst({
        where: eq(roundAssignments.id, id),
      });
      return row ? roundAssignmentSchema.parse(row) : null;
    },
    async listAssignments(roundId) {
      const rows = await db.query.roundAssignments.findMany({
        where: eq(roundAssignments.roundId, roundId),
        orderBy: [asc(roundAssignments.createdAt)],
      });
      return rows.map((r) => roundAssignmentSchema.parse(r));
    },
    async listAssignmentsByRounds(roundIds) {
      if (roundIds.length === 0) return [];
      const rows = await db.query.roundAssignments.findMany({
        where: inArray(roundAssignments.roundId, roundIds),
      });
      return rows.map((r) => roundAssignmentSchema.parse(r));
    },
    async listAssignmentsByReviewer(reviewerId) {
      const rows = await db.query.roundAssignments.findMany({
        where: eq(roundAssignments.reviewerId, reviewerId),
        orderBy: [asc(roundAssignments.createdAt)],
      });
      return rows.map((r) => roundAssignmentSchema.parse(r));
    },
    async findAssignment(roundId, submissionId, reviewerId) {
      const row = await db.query.roundAssignments.findFirst({
        where: and(
          eq(roundAssignments.roundId, roundId),
          eq(roundAssignments.submissionId, submissionId),
          eq(roundAssignments.reviewerId, reviewerId),
        ),
      });
      return row ? roundAssignmentSchema.parse(row) : null;
    },
    async assign(roundId, submissionId, reviewerId) {
      const existing = await db.query.roundAssignments.findFirst({
        where: and(
          eq(roundAssignments.roundId, roundId),
          eq(roundAssignments.submissionId, submissionId),
          eq(roundAssignments.reviewerId, reviewerId),
        ),
      });
      // Assigning again must not reset work already done, so an existing row
      // is returned untouched rather than upserted back to "pending".
      if (existing) return roundAssignmentSchema.parse(existing);

      const [row] = await db
        .insert(roundAssignments)
        .values({ roundId, submissionId, reviewerId, status: "pending", recusalReason: null })
        .returning();
      return roundAssignmentSchema.parse(row);
    },
    async unassign(id) {
      await db.delete(roundAssignments).where(eq(roundAssignments.id, id));
    },
    async unassignIfUnscored(id) {
      // One statement, so a scorecard landing mid-flight loses the race instead
      // of being cascaded away by a delete that already decided it was safe.
      const removed = await db
        .delete(roundAssignments)
        .where(
          and(
            eq(roundAssignments.id, id),
            notExists(
              db
                .select({ one: sql`1` })
                .from(roundScores)
                .where(eq(roundScores.assignmentId, id)),
            ),
          ),
        )
        .returning({ id: roundAssignments.id });
      return removed.length > 0;
    },
    async setAssignmentStatus(id, status, recusalReason) {
      const [row] = await db
        .update(roundAssignments)
        .set({
          status,
          ...(recusalReason === undefined ? {} : { recusalReason }),
          updatedAt: new Date(),
        })
        .where(eq(roundAssignments.id, id))
        .returning();
      return roundAssignmentSchema.parse(row);
    },

    async getScore(assignmentId) {
      const row = await db.query.roundScores.findFirst({
        where: eq(roundScores.assignmentId, assignmentId),
      });
      return row ? roundScoreSchema.parse(row) : null;
    },
    async listScoresByAssignments(assignmentIds) {
      if (assignmentIds.length === 0) return [];
      const rows = await db.query.roundScores.findMany({
        where: inArray(roundScores.assignmentId, assignmentIds),
      });
      return rows.map((r) => roundScoreSchema.parse(r));
    },
    async saveScore(assignmentId, values, submittedAt) {
      const [row] = await db
        .insert(roundScores)
        .values({ assignmentId, values, submittedAt })
        .onConflictDoUpdate({
          target: roundScores.assignmentId,
          set: { values, submittedAt, updatedAt: new Date() },
        })
        .returning();
      return roundScoreSchema.parse(row);
    },
  };
}
