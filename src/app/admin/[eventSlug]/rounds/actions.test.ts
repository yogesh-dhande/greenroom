import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, ReviewRound, RoundAssignment } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer, type SessionUser } from "@/lib/session";
import { recuseFromSubmission, submitScorecard } from "./actions";

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

beforeEach(() => {
  vi.clearAllMocks();
  saveScore = vi.fn();
  setAssignmentStatus = vi.fn();
  repos = {
    events: { getBySlug: vi.fn(async () => event) },
    reviewRounds: {
      getById: vi.fn(async () => round),
      listAssignmentsByReviewer: vi.fn(async () => [ownAssignment]),
      saveScore,
      setAssignmentStatus,
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
