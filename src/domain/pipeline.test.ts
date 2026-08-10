import { describe, expect, it } from "vitest";
import type { PipelineStage } from "@/db/entities";
import {
  countCardsByStage,
  DEFAULT_PIPELINE_STAGE,
  isPipelineStage,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  pipelineStageIndex,
  planStageMove,
} from "@/domain/pipeline";

describe("pipeline stage catalog", () => {
  it("lists the five stages in board order", () => {
    expect(PIPELINE_STAGES).toEqual([
      "identified",
      "contacted",
      "interested",
      "confirmed",
      "declined",
    ]);
  });

  it("labels every stage", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(PIPELINE_STAGE_LABELS[stage]).toBeTruthy();
    }
  });

  it("enrols on the first stage by default", () => {
    expect(DEFAULT_PIPELINE_STAGE).toBe("identified");
    expect(pipelineStageIndex(DEFAULT_PIPELINE_STAGE)).toBe(0);
  });

  it("narrows untrusted input", () => {
    expect(isPipelineStage("interested")).toBe(true);
    expect(isPipelineStage("Interested")).toBe(false);
    expect(isPipelineStage("archived")).toBe(false);
    expect(isPipelineStage(undefined)).toBe(false);
    expect(isPipelineStage(3)).toBe(false);
  });

  it("orders stages by their board position", () => {
    expect(pipelineStageIndex("declined")).toBe(4);
    expect(pipelineStageIndex("contacted")).toBeLessThan(pipelineStageIndex("confirmed"));
  });
});

describe("planStageMove", () => {
  it("allows any stage to follow any other, forwards or backwards", () => {
    expect(planStageMove("identified", "confirmed")).toEqual({
      moved: true,
      from: "identified",
      to: "confirmed",
    });
    expect(planStageMove("declined", "interested")).toEqual({
      moved: true,
      from: "declined",
      to: "interested",
    });
    expect(planStageMove("confirmed", "identified")).toEqual({
      moved: true,
      from: "confirmed",
      to: "identified",
    });
  });

  it("treats a move onto the current stage as a no-op, so no history is written", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(planStageMove(stage, stage)).toEqual({ moved: false, stage });
    }
  });

  it("covers every ordered pair: only the diagonal is a no-op", () => {
    for (const from of PIPELINE_STAGES) {
      for (const to of PIPELINE_STAGES) {
        expect(planStageMove(from, to).moved).toBe(from !== to);
      }
    }
  });
});

describe("countCardsByStage", () => {
  const cards = (stages: PipelineStage[]) => stages.map((stage) => ({ stage }));

  it("keeps every stage present, including the empty ones", () => {
    expect(countCardsByStage([])).toEqual({
      identified: 0,
      contacted: 0,
      interested: 0,
      confirmed: 0,
      declined: 0,
    });
  });

  it("counts cards into their own stage", () => {
    const counts = countCardsByStage(
      cards(["identified", "identified", "confirmed", "declined"]),
    );
    expect(counts.identified).toBe(2);
    expect(counts.confirmed).toBe(1);
    expect(counts.declined).toBe(1);
    expect(counts.contacted).toBe(0);
  });
});
