/**
 * The sourcing pipeline's rules (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * Pure: the stage vocabulary, its board order and labels, the one transition
 * rule that matters, and the presentation rules the board and the table share
 * (which view a URL asks for, how a score reads, how rows are filtered and
 * ordered). No repos, no clock, nothing to mock.
 */
import { pipelineStageSchema, type PipelineStage } from "@/db/entities";

/**
 * Every stage, in board order (left to right).
 *
 * Derived from the entity enum rather than retyped, so the board and the
 * column can never drift apart: adding a stage is one edit in
 * src/db/entities.ts plus a label below.
 */
export const PIPELINE_STAGES: readonly PipelineStage[] = pipelineStageSchema.options;

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  identified: "Identified",
  contacted: "Contacted",
  interested: "Interested",
  confirmed: "Confirmed",
  declined: "Declined",
};

/** The stage a contact enrols on unless the organizer picks another. */
export const DEFAULT_PIPELINE_STAGE: PipelineStage = "identified";

/** Narrows an untrusted string (a URL parameter, a form field) to a stage. */
export function isPipelineStage(value: unknown): value is PipelineStage {
  return pipelineStageSchema.safeParse(value).success;
}

/** Board order as a number, for sorting cards or history by stage. */
export function pipelineStageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/**
 * What a "move this card to <stage>" request resolves to.
 *
 * `moved: false` is not an error — an organizer re-selecting the stage a card
 * already sits on, or dropping a card back in the column it came from, asked
 * for nothing and should get no red toast and, crucially, no history row.
 */
export type StageMovePlan =
  | { moved: false; stage: PipelineStage }
  | { moved: true; from: PipelineStage; to: PipelineStage };

/**
 * The pipeline's only transition rule: any stage may follow any other.
 *
 * Sourcing is not a workflow with gates — a contact who declined can be
 * re-approached next year, and an organizer who mis-clicks needs to walk a
 * card back. The single restriction is that a move onto the current stage is a
 * no-op, so the timestamped history stays a record of things that actually
 * happened rather than of buttons that were pressed.
 */
export function planStageMove(current: PipelineStage, next: PipelineStage): StageMovePlan {
  if (current === next) return { moved: false, stage: current };
  return { moved: true, from: current, to: next };
}

/**
 * The fit score's upper bound (the enrol action validates 0-100).
 *
 * Exported so the scale travels with the number: a bare "85" is unreadable
 * without knowing whether the board scores out of 5, 10 or 100.
 */
export const PIPELINE_SCORE_MAX = 100;

/** "85/100" for a recorded fit score, an em dash for an unscored card. */
export function formatPipelineScore(score: number | null): string {
  return score === null ? "—" : `${score}/${PIPELINE_SCORE_MAX}`;
}

/**
 * The two shapes the same pipeline data is offered in: the funnel board and
 * the outreach table. Board is the default — the funnel is the question the
 * page exists to answer, and the table is the second read.
 */
export type PipelineView = "board" | "table";

export const PIPELINE_VIEW_BOARD: PipelineView = "board";
export const PIPELINE_VIEW_TABLE: PipelineView = "table";

/** Which view the URL's `view` parameter asks for; anything unknown is the board. */
export function resolvePipelineView(requested: string | undefined | null): PipelineView {
  return requested === PIPELINE_VIEW_TABLE ? PIPELINE_VIEW_TABLE : PIPELINE_VIEW_BOARD;
}

/**
 * The table's stage filter: a stage keeps only its own rows, null keeps
 * everything ("All stages").
 */
export function filterByStage<T extends { stage: PipelineStage }>(
  rows: readonly T[],
  stage: PipelineStage | null,
): T[] {
  return stage === null ? [...rows] : rows.filter((row) => row.stage === stage);
}

/**
 * Stalest first: the oldest last-touch at the top.
 *
 * That is the order an outreach pass wants — the table exists to answer "who
 * has nobody spoken to in a while?", and a list that opens on the contact
 * someone messaged this morning answers the opposite question. Sorting is
 * stable, so rows touched at the same instant keep the order they arrived in
 * (the board's newest-updated-first) rather than shuffling between renders.
 */
export function sortByLastTouch<T extends { lastTouchedAt: Date }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.lastTouchedAt.getTime() - b.lastTouchedAt.getTime());
}

/** Card counts per stage, with every stage present (zeros included). */
export function countCardsByStage(
  cards: readonly { stage: PipelineStage }[],
): Record<PipelineStage, number> {
  const counts = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, 0])) as Record<
    PipelineStage,
    number
  >;
  for (const card of cards) counts[card.stage] += 1;
  return counts;
}
