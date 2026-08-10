/**
 * The sourcing pipeline's rules (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * Pure: the stage vocabulary, its board order and labels, and the one
 * transition rule that matters. No repos, no dates, nothing to mock.
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
