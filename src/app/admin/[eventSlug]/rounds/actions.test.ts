import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, ReviewRound, RoundAssignment } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer, type SessionUser } from "@/lib/session";
import { SCORECARD_WOULD_BE_DELETED } from "@/domain/rounds";
import {
  deleteRound,
  recuseFromSubmission,
  submitScorecard,
  unassignSubmission,
} from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRepos: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
  requireAdminOrReviewer: vi.fn(),
}));

const EPOCH = new Date(0);
const reviewer: SessionUser = {
  id: "reviewer-1",
  email: "reviewer@example.com",
  name: "Reviewer",
  role: "reviewer",
};
const event: Event = {
  id: "event-1",
  name: "AI Engineer",
  slug: "aie",
  description: null,
  startDate: "2026-08-11",
  endDate: "2026-08-12",
  timezone: "America/Los_Angeles",
  location: null,
  programPublished: false,
  createdAt: EPOCH,
  updatedAt: EPOCH,
};
const round: ReviewRound = {
  id: "round-1",
  eventId: event.id,
  name: "Final review",
  description: null,
  opensAt: null,
  closesAt: null,
  criteria: [{ id: "rating", label: "Rating", type: "number", min: 1, max: 5 }],
  blindReview: false,
  createdAt: EPOCH,
  updatedAt: EPOCH,
};
const ownAssignment: RoundAssignment = {
  id: "assignment-1",
  roundId: round.id,
  submissionId: "assigned-submission",
  reviewerId: reviewer.id,
  status: "pending",
  recusalReason: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
};

let repos: Repos;
let saveScore: ReturnType<typeof vi.fn>;
let setAssignmentStatus: ReturnType<typeof vi.fn>;
let unassign: ReturnType<typeof vi.fn>;
let getScore: ReturnType<typeof vi.fn>;
let unassignIfUnscored: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  saveScore = vi.fn();
  setAssignmentStatus = vi.fn();
  unassign = vi.fn();
  getScore = vi.fn(async () => null);
  unassignIfUnscored = vi.fn(async () => true);
  repos = {
    events: { getBySlug: vi.fn(async () => event) },
    reviewRounds: {
      getById: vi.fn(async () => round),
      listAssignmentsByReviewer: vi.fn(async () => [ownAssignment]),
      saveScore,
      setAssignmentStatus,
      getAssignment: vi.fn(async () => ownAssignment),
      unassign,
      unassignIfUnscored,
      getScore,
    },
  } as unknown as Repos;
  vi.mocked(getRepos).mockResolvedValue(repos);
  vi.mocked(requireAdminOrReviewer).mockResolvedValue(reviewer);
});

describe("reviewer scorecard action authorization", () => {
  it("rejects a spoofed unassigned submission before saving a scorecard", async () => {
    const result = await submitScorecard(event.slug, round.id, "unassigned-submission", {
      rating: 5,
    });

    expect(result).toEqual({
      ok: false,
      error: "That submission isn't assigned to you in this round",
    });
    expect(repos.reviewRounds.listAssignmentsByReviewer).toHaveBeenCalledWith(reviewer.id);
    expect(saveScore).not.toHaveBeenCalled();
    expect(setAssignmentStatus).not.toHaveBeenCalled();
  });

  it("rejects a spoofed unassigned submission before recording a recusal", async () => {
    const result = await recuseFromSubmission(
      event.slug,
      round.id,
      "unassigned-submission",
      "Conflict",
    );

    expect(result).toEqual({
      ok: false,
      error: "That submission isn't assigned to you in this round",
    });
    expect(repos.reviewRounds.listAssignmentsByReviewer).toHaveBeenCalledWith(reviewer.id);
    expect(setAssignmentStatus).not.toHaveBeenCalled();
    expect(saveScore).not.toHaveBeenCalled();
  });
});

/**
 * Removing an assignment cascades to its scorecard (`round_scores.assignment_id`
 * is `ON DELETE cascade`), so the destructive case has to be refused until the
 * caller says it means it — see decisions.md D-095. The dialog in
 * assignment-manager.tsx is the courtesy; this is the control, because a server
 * action can be called directly.
 */
describe("unassigning a reviewer who has already scored", () => {
  it("refuses, and deletes nothing, until the caller confirms", async () => {
    // The conditional delete is what reports the scorecard: it declines to
    // remove a scored assignment and says so by returning false.
    unassignIfUnscored.mockResolvedValue(false);

    const result = await unassignSubmission(event.slug, round.id, ownAssignment.id);

    expect(result).toEqual({
      ok: false,
      error: "That reviewer has already filed a scorecard — removing the assignment deletes it.",
      code: SCORECARD_WOULD_BE_DELETED,
    });
    expect(unassign).not.toHaveBeenCalled();
  });

  it("goes through once the caller confirms", async () => {
    unassignIfUnscored.mockResolvedValue(false);

    const result = await unassignSubmission(event.slug, round.id, ownAssignment.id, true);

    expect(result).toEqual({ ok: true });
    expect(unassign).toHaveBeenCalledWith(ownAssignment.id);
  });

  it("removes an unscored assignment in one step", async () => {
    unassignIfUnscored.mockResolvedValue(true);

    const result = await unassignSubmission(event.slug, round.id, ownAssignment.id);

    expect(result).toEqual({ ok: true });
    expect(unassignIfUnscored).toHaveBeenCalledWith(ownAssignment.id);
    // The unconditional delete is reserved for the confirmed path.
    expect(unassign).not.toHaveBeenCalled();
  });

  it("never reads-then-deletes — the condition travels with the delete", async () => {
    // A scorecard filed between a separate check and delete would be cascaded
    // away by it, which is the very loss this guard exists to prevent.
    await unassignSubmission(event.slug, round.id, ownAssignment.id);

    expect(getScore).not.toHaveBeenCalled();
  });

  it("does not consult the scorecard at all when the caller already confirmed", async () => {
    await unassignSubmission(event.slug, round.id, ownAssignment.id, true);

    expect(unassignIfUnscored).not.toHaveBeenCalled();
    expect(getScore).not.toHaveBeenCalled();
  });
});

/**
 * Deleting a round cascades through its assignments and every scorecard on
 * them, so it asks the same question `unassignSubmission` does, only wider.
 */
describe("deleting a round that holds scorecards", () => {
  beforeEach(() => {
    repos.reviewRounds.listAssignments = vi.fn(async () => [ownAssignment]);
    repos.reviewRounds.listScoresByAssignments = vi.fn(async () => [
      {
        id: "score-1",
        assignmentId: ownAssignment.id,
        values: { rating: 4 },
        submittedAt: EPOCH,
        createdAt: EPOCH,
        updatedAt: EPOCH,
      },
    ]);
    repos.reviewRounds.delete = vi.fn();
  });

  it("refuses until the caller confirms", async () => {
    const result = await deleteRound(event.slug, round.id);

    expect(result).toEqual({
      ok: false,
      error: "This round has scorecards filed in it — deleting it deletes them too.",
      code: SCORECARD_WOULD_BE_DELETED,
    });
    expect(repos.reviewRounds.delete).not.toHaveBeenCalled();
  });

  it("goes through once the caller confirms", async () => {
    const result = await deleteRound(event.slug, round.id, true);

    expect(result).toEqual({ ok: true });
    expect(repos.reviewRounds.delete).toHaveBeenCalledWith(round.id);
  });

  it("does not ask about a round with no scorecards in it", async () => {
    repos.reviewRounds.listScoresByAssignments = vi.fn(async () => []);

    const result = await deleteRound(event.slug, round.id);

    expect(result).toEqual({ ok: true });
    expect(repos.reviewRounds.delete).toHaveBeenCalledWith(round.id);
  });
});
