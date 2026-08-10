import { describe, expect, it } from "vitest";
import type { PipelineStage } from "@/db/entities";
import {
  countCardsByStage,
  DEFAULT_PIPELINE_STAGE,
  filterByStage,
  formatPipelineScore,
  isPipelineStage,
  PIPELINE_SCORE_MAX,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  PIPELINE_VIEW_BOARD,
  PIPELINE_VIEW_TABLE,
  pipelineStageIndex,
  planStageMove,
  resolvePipelineView,
  sortByLastTouch,
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

describe("formatPipelineScore", () => {
  it("prints the score with the scale it was recorded on", () => {
    expect(formatPipelineScore(85)).toBe(`85/${PIPELINE_SCORE_MAX}`);
    expect(formatPipelineScore(85)).toBe("85/100");
  });

  it("keeps a zero score, which is a judgement and not an absent one", () => {
    expect(formatPipelineScore(0)).toBe("0/100");
  });

  it("shows an em dash when nobody scored the prospect", () => {
    expect(formatPipelineScore(null)).toBe("—");
  });
});

describe("resolvePipelineView", () => {
  it("opens on the board unless the URL asks for the table", () => {
    expect(resolvePipelineView(undefined)).toBe(PIPELINE_VIEW_BOARD);
    expect(resolvePipelineView(null)).toBe(PIPELINE_VIEW_BOARD);
    expect(resolvePipelineView("")).toBe(PIPELINE_VIEW_BOARD);
    expect(resolvePipelineView("board")).toBe(PIPELINE_VIEW_BOARD);
  });

  it("honours ?view=table", () => {
    expect(resolvePipelineView(PIPELINE_VIEW_TABLE)).toBe(PIPELINE_VIEW_TABLE);
  });

  it("falls back to the board for anything it doesn't recognise", () => {
    expect(resolvePipelineView("Table")).toBe(PIPELINE_VIEW_BOARD);
    expect(resolvePipelineView("list")).toBe(PIPELINE_VIEW_BOARD);
  });
});

describe("filterByStage", () => {
  const rows = [
    { id: "a", stage: "identified" as PipelineStage },
    { id: "b", stage: "contacted" as PipelineStage },
    { id: "c", stage: "identified" as PipelineStage },
  ];

  it("keeps only the rows on the chosen stage", () => {
    expect(filterByStage(rows, "identified").map((row) => row.id)).toEqual(["a", "c"]);
    expect(filterByStage(rows, "declined")).toEqual([]);
  });

  it("keeps everything for 'All stages'", () => {
    expect(filterByStage(rows, null)).toEqual(rows);
  });

  it("never hands back the caller's array", () => {
    expect(filterByStage(rows, null)).not.toBe(rows);
  });
});

describe("sortByLastTouch", () => {
  const row = (id: string, isoDate: string) => ({ id, lastTouchedAt: new Date(isoDate) });

  it("puts the stalest prospect first — what an outreach pass opens on", () => {
    const sorted = sortByLastTouch([
      row("fresh", "2026-08-08T00:00:00Z"),
      row("ancient", "2026-01-02T00:00:00Z"),
      row("middling", "2026-06-01T00:00:00Z"),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["ancient", "middling", "fresh"]);
  });

  it("is stable, so equal timestamps keep the order they arrived in", () => {
    const sorted = sortByLastTouch([
      row("first", "2026-08-08T00:00:00Z"),
      row("second", "2026-08-08T00:00:00Z"),
      row("third", "2026-08-08T00:00:00Z"),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("leaves the caller's array alone", () => {
    const rows = [row("b", "2026-08-08T00:00:00Z"), row("a", "2026-01-01T00:00:00Z")];
    const sorted = sortByLastTouch(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(sorted).not.toBe(rows);
  });

  it("handles the empty board", () => {
    expect(sortByLastTouch([])).toEqual([]);
  });
});
