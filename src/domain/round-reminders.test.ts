import { describe, expect, it } from "vitest";
import type { RoundAssignment } from "@/db/entities";
import { pendingReviewers, pendingScorecardsLabel } from "@/domain/round-reminders";

const EPOCH = new Date("2026-01-01T00:00:00Z");

function assignment(overrides: Partial<RoundAssignment> & { id: string }): RoundAssignment {
  return {
    roundId: "round-1",
    submissionId: "sub-1",
    reviewerId: "rev-1",
    status: "pending",
    recusalReason: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

describe("pendingReviewers", () => {
  it("returns only reviewers with at least one unfiled scorecard", () => {
    const assignments = [
      assignment({ id: "a1", reviewerId: "dana" }),
      assignment({ id: "a2", reviewerId: "dana" }),
      assignment({ id: "a3", reviewerId: "marco" }),
    ];
    // dana has filed a1 (1 of 2 done, still pending); marco has filed nothing.
    const pending = pendingReviewers(assignments, new Set(["a1"]));
    expect(pending).toEqual([
      { reviewerId: "dana", assigned: 2, required: 2, done: 1, recused: 0, pending: 1 },
      { reviewerId: "marco", assigned: 1, required: 1, done: 0, recused: 0, pending: 1 },
    ]);
  });

  it("drops reviewers who have filed everything assigned to them", () => {
    const assignments = [assignment({ id: "a1", reviewerId: "dana" })];
    expect(pendingReviewers(assignments, new Set(["a1"]))).toEqual([]);
  });

  it("never counts a recusal as pending, even unfiled", () => {
    const assignments = [assignment({ id: "a1", reviewerId: "dana", status: "recused" })];
    expect(pendingReviewers(assignments, new Set())).toEqual([]);
  });

  it("returns nothing for a round with no assignments", () => {
    expect(pendingReviewers([], new Set())).toEqual([]);
  });
});

describe("pendingScorecardsLabel", () => {
  it("singularizes exactly one", () => {
    expect(pendingScorecardsLabel(1)).toBe("1 scorecard");
  });

  it("pluralizes everything else", () => {
    expect(pendingScorecardsLabel(0)).toBe("0 scorecards");
    expect(pendingScorecardsLabel(3)).toBe("3 scorecards");
  });
});
