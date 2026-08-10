import { describe, expect, it } from "vitest";
import type {
  Review,
  Session,
  Submission,
  SubmissionStatus,
  Task,
  TaskAssignment,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  acceptOnArrival,
  canRecordDecision,
  canRecordReview,
  canViewSubmission,
  isRoutedToReviewer,
  planAcceptanceConversion,
  planDecision,
  resolveQueueView,
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
    resumeToken: null,
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
    contentStatus: "approved",
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
    const rows = [
      { id: "a", formId: "form-1", status: "submitted" as SubmissionStatus },
      { id: "b", formId: "form-1", status: "submitted" as SubmissionStatus },
      { id: "c", formId: "form-1", status: "submitted" as SubmissionStatus },
    ];
    const tracks = { a: ["trk-1"], b: ["trk-2"], c: ["trk-2", "trk-3"] };

    expect(visibleSubmissions(rows, tracks, "reviewer", ["trk-2"]).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
    expect(visibleSubmissions(rows, tracks, "admin", ["trk-2"])).toHaveLength(3);
  });

  it("keeps unsubmitted drafts out of a reviewer's queue but not an admin's", () => {
    // D-034, D-038: a draft is a proposal nobody has sent yet — reviewing it would
    // be judging work in progress.
    const rows = [
      { id: "a", formId: "form-1", status: "draft" as SubmissionStatus },
      { id: "b", formId: "form-1", status: "submitted" as SubmissionStatus },
    ];
    const tracks = { a: ["trk-1"], b: ["trk-1"] };

    expect(visibleSubmissions(rows, tracks, "reviewer", ["trk-1"]).map((r) => r.id)).toEqual(["b"]);
    expect(visibleSubmissions(rows, tracks, "admin", ["trk-1"])).toHaveLength(2);
  });

  it("never shows a reviewer a submission that skipped review", () => {
    // D-041: a session-type form's proposals are sessions on arrival — accepted,
    // in a track the reviewer owns, and still none of their business.
    const rows = [
      { id: "a", formId: "cfp", status: "approved" as SubmissionStatus },
      { id: "b", formId: "invited", status: "approved" as SubmissionStatus },
    ];
    const tracks = { a: ["trk-1"], b: ["trk-1"] };
    const options = { directSessionFormIds: new Set(["invited"]) };

    expect(
      visibleSubmissions(rows, tracks, "reviewer", ["trk-1"], options).map((r) => r.id),
    ).toEqual(["a"]);
    // The organizer still sees it — it's their programme.
    expect(visibleSubmissions(rows, tracks, "admin", ["trk-1"], options)).toHaveLength(2);
  });
});

describe("resolveQueueView (D-066)", () => {
  it("lands a reviewer with assignments on them, and honours an explicit switch", () => {
    expect(resolveQueueView(undefined, 5)).toBe("assigned");
    expect(resolveQueueView("all", 5)).toBe("all");
    expect(resolveQueueView("assigned", 5)).toBe("assigned");
  });

  it("falls back to the track-scoped list when there is no assigned work", () => {
    // A reviewer with nothing assigned — and an admin, who never has an
    // assigned count here — sees the list exactly as D-047 describes it.
    expect(resolveQueueView(undefined, 0)).toBe("all");
    expect(resolveQueueView("assigned", 0)).toBe("all");
  });

  it("ignores a value that isn't one of the two lists", () => {
    expect(resolveQueueView("mine", 3)).toBe("assigned");
    expect(resolveQueueView("", 3)).toBe("assigned");
    expect(resolveQueueView(null, 0)).toBe("all");
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
      // Accepted content is approved content (decisions.md D-072) — the talk
      // must reach the public program it was just accepted for.
      contentStatus: "approved",
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

// ---------------------------------------------------------------------------
// Session-type forms (decisions.md D-041)
// ---------------------------------------------------------------------------

/**
 * An in-memory stand-in for the tables a decision spans, so the real
 * `acceptOnArrival` runs end to end — the whole point of D-041 is that it goes
 * through the same conversion an admin's accept does, which is only worth
 * asserting against the actual code path.
 */
function fakeRepos(seed: { submissions: Submission[]; tasks?: Task[] }) {
  const submissions = [...seed.submissions];
  const sessions: Session[] = [];
  const sessionSpeakers: Record<string, string[]> = {};
  const assignments: TaskAssignment[] = [];

  const repos = {
    submissions: {
      getById: async (id: string) => submissions.find((row) => row.id === id) ?? null,
      update: async (id: string, patch: Partial<Submission>) => {
        const index = submissions.findIndex((row) => row.id === id);
        submissions[index] = { ...submissions[index], ...patch };
        return submissions[index];
      },
      listTrackIds: async () => ["trk-1"],
      listSpeakers: async (submissionId: string) => [
        // Deliberately co-first, so the primary-speaker ordering is real.
        { submissionId, userId: "usr-2", role: "co" as const },
        { submissionId, userId: "usr-1", role: "primary" as const },
      ],
    },
    sessions: {
      getBySubmission: async (submissionId: string) =>
        sessions.find((row) => row.submissionId === submissionId) ?? null,
      create: async (input: Omit<Session, "id" | "createdAt" | "updatedAt">) => {
        const created: Session = {
          id: `ses-${sessions.length + 1}`,
          ...input,
          createdAt: EPOCH,
          updatedAt: EPOCH,
        };
        sessions.push(created);
        return created;
      },
      update: async (id: string, patch: Partial<Session>) => {
        const index = sessions.findIndex((row) => row.id === id);
        sessions[index] = { ...sessions[index], ...patch };
        return sessions[index];
      },
      setSpeakers: async (sessionId: string, speakerIds: string[]) => {
        sessionSpeakers[sessionId] = speakerIds;
      },
    },
    tasks: {
      listAutoAssignByEvent: async () => seed.tasks ?? [],
    },
    taskAssignments: {
      listBySpeaker: async (speakerId: string) =>
        assignments.filter((row) => row.speakerId === speakerId),
      create: async (input: Omit<TaskAssignment, "id" | "createdAt" | "updatedAt">) => {
        const created: TaskAssignment = {
          id: `asg-${assignments.length + 1}`,
          ...input,
          createdAt: EPOCH,
          updatedAt: EPOCH,
        };
        assignments.push(created);
        return created;
      },
    },
  };

  return { repos: repos as unknown as Repos, submissions, sessions, sessionSpeakers, assignments };
}

describe("acceptOnArrival", () => {
  const NOW = new Date("2026-05-01T17:00:00.000Z");

  it("lands a submission exactly as an accepted abstract does", async () => {
    const fake = fakeRepos({
      submissions: [submission({ id: "sub-1", status: "submitted" })],
      tasks: [task("tsk-1")],
    });

    const result = await acceptOnArrival({ repos: fake.repos }, { submissionId: "sub-1", now: NOW });

    // Accepted, timed — and by nobody, which is how "the form decided" is
    // recorded (D-041).
    expect(result.submission.status).toBe("approved");
    expect(result.submission.decidedAt).toEqual(NOW);
    expect(result.submission.decidedBy).toBeNull();

    // A session that exists but hasn't been placed on the agenda yet.
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0].status).toBe("confirmed");
    expect(fake.sessions[0].day).toBeNull();
    expect(fake.sessions[0].startTime).toBeNull();
    expect(fake.sessions[0].roomId).toBeNull();
    expect(fake.sessions[0].submissionId).toBe("sub-1");

    // Speakers and onboarding work flow exactly as acceptance does.
    expect(fake.sessionSpeakers[fake.sessions[0].id]).toEqual(["usr-1", "usr-2"]);
    expect(fake.assignments.map((a) => `${a.taskId}/${a.speakerId}`)).toEqual([
      "tsk-1/usr-1",
      "tsk-1/usr-2",
    ]);
  });

  it("sends no decision email — the form's own confirmation already went out", async () => {
    const fake = fakeRepos({ submissions: [submission({ id: "sub-1", status: "submitted" })] });
    const result = await acceptOnArrival({ repos: fake.repos }, { submissionId: "sub-1" });
    expect(result.deliveries).toEqual([]);
  });

  it("is idempotent: a retry adds no second session", async () => {
    const fake = fakeRepos({
      submissions: [submission({ id: "sub-1", status: "submitted" })],
      tasks: [task("tsk-1")],
    });

    await acceptOnArrival({ repos: fake.repos }, { submissionId: "sub-1" });
    const second = await acceptOnArrival({ repos: fake.repos }, { submissionId: "sub-1" });

    expect(fake.sessions).toHaveLength(1);
    expect(second.sessionCreated).toBe(false);
    expect(fake.assignments).toHaveLength(2);
  });

  it("refuses a draft: a proposal nobody sent yet is not a session", async () => {
    // The conversion happens at submit, never at draft-save (D-041) — and the
    // domain won't do it even if a caller asks.
    const fake = fakeRepos({ submissions: [submission({ id: "sub-1", status: "draft" })] });
    await expect(
      acceptOnArrival({ repos: fake.repos }, { submissionId: "sub-1" }),
    ).rejects.toThrow(/cannot be decided/);
    expect(fake.sessions).toEqual([]);
  });
});
