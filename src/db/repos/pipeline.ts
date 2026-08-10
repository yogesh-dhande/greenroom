import type { PipelineCard, PipelineStage, PipelineStageEvent } from "@/db/entities";

/**
 * The sourcing pipeline (spec.md "Org-level speaker CRM", decisions.md
 * D-077): one card per contact, plus the append-only stage history behind it.
 *
 * One repo owns both tables for the same reason `ReviewRoundsRepo` owns its
 * assignments — a stage event only exists inside a card, and every write that
 * touches one has to touch the other atomically enough that the board and its
 * history can never disagree.
 */

/** What an enrol writes: the starting stage plus the optional judgement. */
export interface EnrollInput {
  userId: string;
  stage: PipelineStage;
  score?: number | null;
  rationale?: string | null;
  /** Who enrolled them; null for an automated path. */
  actorUserId?: string | null;
}

/** A card with its history, newest first — the card detail panel. */
export interface PipelineCardWithHistory {
  card: PipelineCard;
  history: PipelineStageEvent[];
}

/**
 * The outcome of a stage move. `stageEvent` is null when the card was already
 * on the requested stage: a same-stage move is a no-op that must not add a
 * history row (`planStageMove` in src/domain/pipeline.ts is the rule), so the
 * caller can tell "nothing happened" from "moved" without diffing.
 */
export interface StageMoveResult {
  card: PipelineCard;
  stageEvent: PipelineStageEvent | null;
}

export interface PipelineRepo {
  getCard(id: string): Promise<PipelineCard | null>;
  getCardByUser(userId: string): Promise<PipelineCard | null>;
  /** The whole board, newest-updated first. */
  listCards(): Promise<PipelineCard[]>;
  /** Cards for a set of contacts — what the directory reads to badge rows. */
  listCardsByUsers(userIds: string[]): Promise<PipelineCard[]>;
  /**
   * Enrols a contact, writing the initial stage event (`fromStage` null).
   * Rejects a second enrolment for the same contact — one card per contact is
   * a uniqueness rule, not a race to win — so callers check `getCardByUser`
   * first when they want upsert behaviour.
   */
  enroll(input: EnrollInput): Promise<PipelineCardWithHistory>;
  /**
   * Moves a card and records the move. Any stage may follow any other; only a
   * move to the stage the card already occupies is refused (silently, as a
   * no-op), because a history of "identified -> identified" is noise.
   */
  moveStage(
    cardId: string,
    toStage: PipelineStage,
    actorUserId: string | null,
  ): Promise<StageMoveResult>;
  /** Null when the card is gone. */
  getCardWithHistory(cardId: string): Promise<PipelineCardWithHistory | null>;
  /** Stage history for one contact, newest first; empty when unenrolled. */
  listHistoryByUser(userId: string): Promise<PipelineStageEvent[]>;
}
