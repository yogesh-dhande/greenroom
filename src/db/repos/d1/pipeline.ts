import { desc, eq, inArray } from "drizzle-orm";
import { pipelineCardSchema, pipelineStageEventSchema } from "@/db/entities";
import { pipelineCards, pipelineStageEvents } from "@/db/schema";
import type { EnrollInput, PipelineRepo } from "@/db/repos/pipeline";
import { planStageMove } from "@/domain/pipeline";
import { inIdChunks } from "./chunk";
import type { DrizzleD1 } from "./client";

/**
 * D1/Drizzle implementation of the sourcing pipeline (decisions.md D-077).
 *
 * The no-op rule for a same-stage move is `planStageMove` from
 * src/domain/pipeline.ts rather than an inline comparison here: it is the
 * rule the UI also asks before offering the control, and one implementation
 * means the board can't offer a move the write path then silently drops (or
 * the reverse — a history row for a move that never happened).
 */
export function createPipelineRepo(db: DrizzleD1): PipelineRepo {
  async function historyFor(cardId: string) {
    const rows = await db.query.pipelineStageEvents.findMany({
      where: eq(pipelineStageEvents.cardId, cardId),
      orderBy: [desc(pipelineStageEvents.createdAt)],
    });
    return rows.map((row) => pipelineStageEventSchema.parse(row));
  }

  return {
    async getCard(id) {
      const row = await db.query.pipelineCards.findFirst({ where: eq(pipelineCards.id, id) });
      return row ? pipelineCardSchema.parse(row) : null;
    },

    async getCardByUser(userId) {
      const row = await db.query.pipelineCards.findFirst({
        where: eq(pipelineCards.userId, userId),
      });
      return row ? pipelineCardSchema.parse(row) : null;
    },

    async listCards() {
      const rows = await db.query.pipelineCards.findMany({
        orderBy: [desc(pipelineCards.updatedAt)],
      });
      return rows.map((row) => pipelineCardSchema.parse(row));
    },

    async listCardsByUsers(userIds) {
      const rows = await inIdChunks(userIds, (chunk) =>
        db.query.pipelineCards.findMany({ where: inArray(pipelineCards.userId, chunk) }),
      );
      return rows.map((row) => pipelineCardSchema.parse(row));
    },

    async enroll(input: EnrollInput) {
      const [cardRow] = await db
        .insert(pipelineCards)
        .values({
          userId: input.userId,
          stage: input.stage,
          score: input.score ?? null,
          rationale: input.rationale ?? null,
        })
        .returning();
      const card = pipelineCardSchema.parse(cardRow);

      // The enrol event carries a null `fromStage`: the card had no previous
      // stage, which is different from having been moved back to where it
      // started (decisions.md D-077's timestamped history).
      const [eventRow] = await db
        .insert(pipelineStageEvents)
        .values({
          cardId: card.id,
          fromStage: null,
          toStage: card.stage,
          actorUserId: input.actorUserId ?? null,
        })
        .returning();

      return { card, history: [pipelineStageEventSchema.parse(eventRow)] };
    },

    async moveStage(cardId, toStage, actorUserId) {
      const existing = await db.query.pipelineCards.findFirst({
        where: eq(pipelineCards.id, cardId),
      });
      if (!existing) throw new Error(`No pipeline card ${cardId}`);
      const card = pipelineCardSchema.parse(existing);

      const plan = planStageMove(card.stage, toStage);
      if (!plan.moved) return { card, stageEvent: null };

      const [updatedRow] = await db
        .update(pipelineCards)
        .set({ stage: plan.to, updatedAt: new Date() })
        .where(eq(pipelineCards.id, cardId))
        .returning();
      const [eventRow] = await db
        .insert(pipelineStageEvents)
        .values({
          cardId,
          fromStage: plan.from,
          toStage: plan.to,
          actorUserId,
        })
        .returning();

      return {
        card: pipelineCardSchema.parse(updatedRow),
        stageEvent: pipelineStageEventSchema.parse(eventRow),
      };
    },

    async getCardWithHistory(cardId) {
      const row = await db.query.pipelineCards.findFirst({
        where: eq(pipelineCards.id, cardId),
      });
      if (!row) return null;
      return { card: pipelineCardSchema.parse(row), history: await historyFor(cardId) };
    },

    async listHistoryByUser(userId) {
      const card = await db.query.pipelineCards.findFirst({
        where: eq(pipelineCards.userId, userId),
        columns: { id: true },
      });
      if (!card) return [];
      return historyFor(card.id);
    },
  };
}
