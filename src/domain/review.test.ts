import { describe, expect, it } from "vitest";
import type {
  Review,
  Session,
  Submission,
  SubmissionStatus,
  Task,
  TaskAssignment,
} from "@/db/entities";
import {
  canRecordDecision,
  canRecordReview,
  canViewSubmission,
  isRoutedToReviewer,
  planAcceptanceConversion,
  planDecision,
  tallyReviews,
  tallyReviewsBySubmission,
  visibleSubmissions,
} from "@/domain/review";

const EPOCH = new Date(0);

function review(overrides: Partial<Review> & { id: string }): Review {
  return {
    submissionId: "sub-1",
    reviewerId: "rev-1",
    score: null,
    comment: null,
    recommendation: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "sub-1",
    eventId: "evt-1",
    formId: "form-1",
    title: "Retrieval that survives production traffic",
    description: "What broke and what we measured.",
    answers: {},
    status: "submitted" as SubmissionStatus,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses-1",
    eventId: "evt-1",
    title: "Retrieval that survives production traffic",
    description: null,
    submissionId: "sub-1",
    trackId: "trk-1",
    roomId: null,
    day: null,
    startTime: null,
    endTime: null,
    status: "confirmed",
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function task(id: string): Task {
  return {
    id,
    eventId: "evt-1",
    title: `Task ${id}`,
    instructions: null,
    type: "confirm",
    formId: null,
    dueAt: null,
    autoAssignOnAccept: true,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

function assignment(taskId: string, speakerId: string): TaskAssignment {
  return {
    id: `${taskId}-${speakerId}`,
    taskId,
    speakerId,
    status: "pending",
    completedAt: null,
    responseJson: null,
    fileUrl: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

// ---------------------------------------------------------------------------

describe("tallyReviews", () => {
  it("returns an empty tally when nobody has reviewed", () => {
    expect(tallyReviews([])).toEqual({
      total: 0,
      approve: 0,
      maybe: 0,
      deny: 0,
      voted: 0,
      averageScore: null,
      leaning: null,
    });
  });

  it("counts each recommendation and picks the leader", () => {
    const tally = tallyReviews([
      review({ id: "r1", recommendation: "approve" }),
      review({ id: "r2", recommendation: "approve" }),
      review({ id: "r3", recommendation: "deny" }),
    ]);
    expect(tally.approve).toBe(2);
    expect(tally.deny).toBe(1);
    expect(tally.maybe).toBe(0);
    expect(tally.leaning).toBe("approve");
  });

  it("reports no leaning when the leaders are tied", () => {
    const tally = tallyReviews([
      review({ id: "r1", recommendation: "approve" }),
      review({ id: "r2", recommendation: "deny" }),
    ]);
    expect(tally.leaning).toBeNull();
  });

  it("counts comment-only reviews in the total but not as votes", () => {
    const tally = tallyReviews([
      review({ id: "r1", comment: "Needs a co-speaker." }),
      review({ id: "r2", recommendation: "maybe" }),
    ]);
    expect(tally.total).toBe(2);
    expect(tally.voted).toBe(1);
    expect(tally.leaning).toBe("maybe");
  });

  it("averages only the reviews that carry a score", () => {
    const tally = tallyReviews([
      review({ id: "r1", score: 5, recommendation: "approve" }),
      review({ id: "r2", score: 3, recommendation: "maybe" }),
      review({ id: "r3", recommendation: "deny" }),
    ]);
    expect(tally.averageScore).toBe(4);
  });

  it("groups a mixed list by submission", () => {
    const tallies = tallyReviewsBySubmission([
      review({ id: "r1", submissionId: "a", recommendation: "approve" }),
      review({ id: "r2", submissionId: "b", recommendation: "deny" }),
      review({ id: "r3", submissionId: "a", recommendation: "approve" }),
    ]);
    expect(tallies.a.approve).toBe(2);
    expect(tallies.b.deny).toBe(1);
    expect(tallies.c).toBeUndefined();
  });
});

describe("routing", () => {
  it("routes a submission to a reviewer who owns any of its tracks", () => {
    expect(isRoutedToReviewer(["trk-1", "trk-3"], ["trk-3"])).toBe(true);
    expect(isRoutedToReviewer(["trk-1"], ["trk-2"])).toBe(false);
  });

  it("routes an untracked submission to nobody", () => {
    expect(isRoutedToReviewer(["trk-1"], [])).toBe(false);
    expect(isRoutedToReviewer([], ["trk-1"])).toBe(false);
  });

  it("lets admins see everything and speakers see nothing", () => {
    expect(canViewSubmission("admin", [], [])).toBe(true);
    expect(canViewSubmission("speaker", ["trk-1"], ["trk-1"])).toBe(false);
  });

  it("narrows a reviewer's list to their own tracks", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const tracks = { a: ["trk-1"], b: ["trk-2"], c: ["trk-2", "trk-3"] };

    expect(visibleSubmissions(rows, tracks, "reviewer", ["trk-2"]).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
    expect(visibleSubmissions(rows, tracks, "admin", ["trk-2"])).toHaveLength(3);
  });
});

describe("who may decide", () => {
  it("keeps the binding decision with admins", () => {
    expect(canRecordDecision("admin")).toBe(true);
    expect(canRecordDecision("reviewer")).toBe(false);
    expect(canRecordDecision("speaker")).toBe(false);
  });

  it("lets reviewers and admins record a recommendation", () => {
    expect(canRecordReview("reviewer")).toBe(true);
    expect(canRecordReview("admin")).toBe(true);
    expect(canRecordReview("speaker")).toBe(false);
  });
});

describe("planDecision", () => {
  const NOW = new Date("2026-04-15T10:00:00Z");

  it("stamps who decided, when, and the note", () => {
    const plan = planDecision(submission(), "approved", "admin-1", {
      note: "Strong practitioner story.",
      now: NOW,
    });
    expect(plan.patch).toEqual({
      status: "approved",
      decidedBy: "admin-1",
      decidedAt: NOW,
      decisionNote: "Strong practitioner story.",
    });
  });

  it("only converts on an accept", () => {
    expect(planDecision(submission(), "approved", "a", { now: NOW }).convert).toBe(true);
    expect(planDecision(submission(), "maybe", "a", { now: NOW }).convert).toBe(false);
    expect(planDecision(submission(), "denied", "a", { now: NOW }).convert).toBe(false);
  });

  it("stands the session down when an accepted talk is later declined", () => {
    const accepted = submission({ status: "approved" });
    expect(planDecision(accepted, "denied", "a", { now: NOW }).cancelSession).toBe(true);
    expect(planDecision(accepted, "maybe", "a", { now: NOW }).cancelSession).toBe(true);
    expect(planDecision(accepted, "approved", "a", { now: NOW }).cancelSession).toBe(false);
    expect(planDecision(submission(), "denied", "a", { now: NOW }).cancelSession).toBe(false);
  });

  it("keeps the existing note when the decision carries none", () => {
    const decided = submission({ status: "maybe", decisionNote: "Overlaps the retrieval talk." });
    expect(planDecision(decided, "approved", "a", { now: NOW }).patch.decisionNote).toBe(
      "Overlaps the retrieval talk.",
    );
  });

  it("refuses to decide a draft or a withdrawn proposal", () => {
    expect(() => planDecision(submission({ status: "draft" }), "approved", "a")).toThrow();
    expect(() => planDecision(submission({ status: "withdrawn" }), "denied", "a")).toThrow();
  });

  it("notifies by default and stays quiet when asked to", () => {
    expect(planDecision(submission(), "denied", "a", { now: NOW }).notify).toBe(true);
    expect(planDecision(submission(), "denied", "a", { now: NOW, notify: false }).notify).toBe(false);
  });
});

describe("planAcceptanceConversion", () => {
  const base = {
    submission: submission({ status: "approved" }),
    trackIds: ["trk-1", "trk-2"],
    speakerIds: ["usr-1", "usr-2"],
    existingSession: null,
    autoAssignTasks: [task("tsk-1"), task("tsk-2")],
    existingAssignments: [] as TaskAssignment[],
  };

  it("creates an unscheduled session on the submission's first track", () => {
    const plan = planAcceptanceConversion(base);
    expect(plan.createSession).toEqual({
      eventId: "evt-1",
      title: "Retrieval that survives production traffic",
      description: "What broke and what we measured.",
      submissionId: "sub-1",
      trackId: "trk-1",
      roomId: null,
      day: null,
      startTime: null,
      endTime: null,
      status: "confirmed",
    });
  });

  it("puts every speaker on the session, primary order preserved", () => {
    expect(planAcceptanceConversion(base).speakerIds).toEqual(["usr-1", "usr-2"]);
  });

  it("assigns every auto-assign task to every speaker", () => {
    const plan = planAcceptanceConversion(base);
    expect(plan.newAssignments).toHaveLength(4);
    expect(plan.newAssignments.every((a) => a.status === "pending")).toBe(true);
    expect(plan.newAssignments.map((a) => `${a.taskId}/${a.speakerId}`)).toEqual([
      "tsk-1/usr-1",
      "tsk-1/usr-2",
      "tsk-2/usr-1",
      "tsk-2/usr-2",
    ]);
  });

  it("is idempotent: re-accepting adds no second session and no duplicate tasks", () => {
    const plan = planAcceptanceConversion({
      ...base,
      existingSession: session(),
      existingAssignments: [
        assignment("tsk-1", "usr-1"),
        assignment("tsk-1", "usr-2"),
        assignment("tsk-2", "usr-1"),
        assignment("tsk-2", "usr-2"),
      ],
    });
    expect(plan.createSession).toBeNull();
    expect(plan.sessionUpdate).toBeNull();
    expect(plan.newAssignments).toEqual([]);
  });

  it("fills only the gaps when a co-speaker joined after the first accept", () => {
    const plan = planAcceptanceConversion({
      ...base,
      existingSession: session(),
      existingAssignments: [assignment("tsk-1", "usr-1"), assignment("tsk-2", "usr-1")],
    });
    expect(plan.newAssignments.map((a) => `${a.taskId}/${a.speakerId}`)).toEqual([
      "tsk-1/usr-2",
      "tsk-2/usr-2",
    ]);
  });

  it("un-cancels the session of a talk that is accepted again", () => {
    const plan = planAcceptanceConversion({
      ...base,
      existingSession: session({ status: "cancelled" }),
    });
    expect(plan.sessionUpdate).toEqual({ id: "ses-1", patch: { status: "confirmed" } });
  });

  it("never overwrites a session the organizer has since retitled", () => {
    const plan = planAcceptanceConversion({
      ...base,
      existingSession: session({ title: "Opening keynote: retrieval in production" }),
    });
    expect(plan.createSession).toBeNull();
    expect(plan.sessionUpdate).toBeNull();
  });

  it("copes with a submission that picked no track", () => {
    expect(planAcceptanceConversion({ ...base, trackIds: [] }).createSession?.trackId).toBeNull();
  });

  it("assigns nothing when the event has no auto-assign tasks", () => {
    expect(planAcceptanceConversion({ ...base, autoAssignTasks: [] }).newAssignments).toEqual([]);
  });
});
