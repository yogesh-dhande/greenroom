import { describe, expect, it } from "vitest";
import { RESERVED_FIELD_IDS } from "@/db/entities";
import type {
  Event,
  Form,
  NewSession,
  NewSessionRevision,
  NewSubmission,
  NewTaskAssignment,
  Session,
  SessionRevision,
  Submission,
  SubmissionSpeaker,
  Task,
  TaskAssignment,
  Track,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import { DEFAULT_CFP_FIELDS, publicFields } from "@/domain/forms";
import {
  countSubmissionsByStatus,
  isIdenticalSubmittedProposal,
  matchesSubmissionSearch,
  newResumeToken,
  queuePosition,
  saveSubmission,
  speakerLimitState,
  updateSubmissionTracks,
} from "@/domain/submissions";

const NOW = new Date("2026-05-01T17:00:00.000Z");

function timestamps() {
  return { createdAt: NOW, updatedAt: NOW };
}

function event(): Event {
  return {
    id: "event-1",
    name: "AI Engineer Summit 2026",
    slug: "aie-2026",
    description: null,
    startDate: "2026-06-16",
    endDate: "2026-06-18",
    timezone: "America/Los_Angeles",
    location: null,
    programPublished: true,
    ...timestamps(),
  };
}

function form(overrides: Partial<Form> = {}): Form {
  return {
    id: "form-1",
    eventId: "event-1",
    name: "Call for Speakers",
    slug: "aie-2026-cfp",
    type: "abstract",
    welcomeCopy: null,
    fields: DEFAULT_CFP_FIELDS,
    opensAt: null,
    closesAt: null,
    confirmationPageContent: null,
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    isPublished: true,
    ...timestamps(),
    ...overrides,
  };
}

const TRACKS: Track[] = [
  { id: "track-1", eventId: "event-1", name: "AI Engineering", color: null, ...timestamps() },
];

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    eventId: "event-1",
    title: "Retrieval that survives production traffic",
    description: null,
    submissionId: "submission-1",
    trackId: null,
    roomId: null,
    day: null,
    startTime: null,
    endTime: null,
    status: "confirmed",
    contentStatus: "approved",
    ...timestamps(),
    ...overrides,
  };
}

function speaker(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "priya@example.test",
    name: "Priya Raman",
    role: "speaker",
    emailVerified: true,
    title: null,
    company: null,
    bio: "Builds retrieval systems.",
    headshotUrl: null,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
    ...timestamps(),
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    eventId: "event-1",
    title: "Upload your slides",
    instructions: null,
    type: "file_request",
    formId: null,
    dueAt: null,
    autoAssignOnAccept: true,
    ...timestamps(),
    ...overrides,
  };
}

/** A complete set of answers to the default CFP form. */
function answers(overrides: Record<string, unknown> = {}) {
  const fields = publicFields(DEFAULT_CFP_FIELDS, ["AI Engineering"]);
  const values: Record<string, unknown> = {};
  for (const field of fields) values[field.id] = field.type === "checkbox" ? false : "";
  return {
    ...values,
    title: "Retrieval that survives production traffic",
    description: "A practitioner story about rebuilding retrieval three times.",
    tracks: ["AI Engineering"],
    speaker_name: "Priya Raman",
    speaker_email: "priya@example.test",
    speaker_bio: "Builds retrieval systems.",
    code_of_conduct: true,
    ...overrides,
  };
}

/**
 * An in-memory stand-in for the four tables a submission spans. Enough to run
 * the real `saveSubmission` — the point is to exercise the actual create /
 * promote / limit code rather than assert against mocks.
 */
function fakeRepos(
  seed: {
    submissions?: Submission[];
    users?: User[];
    sessions?: Session[];
    tracks?: Track[];
    tasks?: Task[];
    taskAssignments?: TaskAssignment[];
  } = {},
) {
  const submissions: Submission[] = [...(seed.submissions ?? [])];
  const users: User[] = [...(seed.users ?? [])];
  const sessions: Session[] = [...(seed.sessions ?? [])];
  const tracks: Track[] = [...(seed.tracks ?? [])];
  const tasks: Task[] = [...(seed.tasks ?? [])];
  const taskAssignments: TaskAssignment[] = [...(seed.taskAssignments ?? [])];
  const sessionRevisions: SessionRevision[] = [];
  const speakerLinks: SubmissionSpeaker[] = [];
  const trackLinks: Record<string, string[]> = {};
  const sessionSpeakerLinks: Record<string, string[]> = {};

  const repos = {
    users: {
      getById: async (id: string) => users.find((row) => row.id === id) ?? null,
      getByEmail: async (email: string) => users.find((row) => row.email === email) ?? null,
      create: async (input: Omit<User, "id" | "createdAt" | "updatedAt">) => {
        const created: User = { id: `user-${users.length + 1}`, ...input, ...timestamps() };
        users.push(created);
        return created;
      },
      update: async (id: string, patch: Partial<User>) => {
        const index = users.findIndex((row) => row.id === id);
        users[index] = { ...users[index], ...patch };
        return users[index];
      },
    },
    submissions: {
      getById: async (id: string) => submissions.find((row) => row.id === id) ?? null,
      create: async (input: NewSubmission) => {
        const created: Submission = {
          id: `submission-${submissions.length + 1}`,
          ...input,
          ...timestamps(),
        };
        submissions.push(created);
        return created;
      },
      update: async (id: string, patch: Partial<NewSubmission>) => {
        const index = submissions.findIndex((row) => row.id === id);
        submissions[index] = { ...submissions[index], ...patch };
        return submissions[index];
      },
      listByFormAndSpeaker: async (formId: string, userId: string) =>
        submissions.filter(
          (row) =>
            row.formId === formId &&
            speakerLinks.some(
              (link) =>
                link.submissionId === row.id && link.userId === userId && link.role === "primary",
            ),
        ),
      setTracks: async (submissionId: string, trackIds: string[]) => {
        trackLinks[submissionId] = trackIds;
      },
      listTrackIds: async (submissionId: string) => trackLinks[submissionId] ?? [],
      listSpeakers: async (submissionId: string) =>
        speakerLinks.filter((link) => link.submissionId === submissionId),
      addSpeaker: async (submissionId: string, userId: string, role: "primary" | "co") => {
        if (
          !speakerLinks.some((link) => link.submissionId === submissionId && link.userId === userId)
        ) {
          speakerLinks.push({ submissionId, userId, role });
        }
      },
      removeSpeaker: async (submissionId: string, userId: string) => {
        const index = speakerLinks.findIndex(
          (link) => link.submissionId === submissionId && link.userId === userId,
        );
        if (index >= 0) speakerLinks.splice(index, 1);
      },
    },
    sessions: {
      getBySubmission: async (submissionId: string) =>
        sessions.find((row) => row.submissionId === submissionId) ?? null,
      setSpeakers: async (sessionId: string, userIds: string[]) => {
        sessionSpeakerLinks[sessionId] = [...userIds];
      },
      update: async (id: string, patch: Partial<NewSession>) => {
        const index = sessions.findIndex((row) => row.id === id);
        sessions[index] = { ...sessions[index], ...patch };
        return sessions[index];
      },
    },
    sessionRevisions: {
      create: async (input: NewSessionRevision) => {
        const created: SessionRevision = {
          id: `revision-${sessionRevisions.length + 1}`,
          ...input,
          createdAt: NOW,
        };
        sessionRevisions.push(created);
        return created;
      },
      listBySession: async (sessionId: string) =>
        sessionRevisions.filter((row) => row.sessionId === sessionId),
    },
    tasks: {
      listAutoAssignByEvent: async (eventId: string) =>
        tasks.filter((row) => row.eventId === eventId && row.autoAssignOnAccept),
    },
    taskAssignments: {
      listBySpeaker: async (speakerId: string) =>
        taskAssignments.filter((row) => row.speakerId === speakerId),
      create: async (input: NewTaskAssignment) => {
        const created: TaskAssignment = {
          id: `assignment-${taskAssignments.length + 1}`,
          ...input,
          ...timestamps(),
        };
        taskAssignments.push(created);
        return created;
      },
    },
    tracks: {
      listByEvent: async (eventId: string) => tracks.filter((row) => row.eventId === eventId),
    },
  };

  return {
    repos: repos as unknown as Repos,
    submissions,
    users,
    sessions,
    tasks,
    taskAssignments,
    sessionRevisions,
    trackLinks,
    sessionSpeakerLinks,
  };
}

function save(repos: Repos, values: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return saveSubmission(
    { repos },
    { form: form(), event: event(), tracks: TRACKS, values, ...extra },
  );
}

// ---------------------------------------------------------------------------
// Authenticated repeat-submit guard (eval gap F3)
// ---------------------------------------------------------------------------

describe("authenticated duplicate submissions", () => {
  it("refuses the same signed-in speaker's exact proposal even after its status changes", async () => {
    const state = fakeRepos();
    const first = await save(state.repos, answers(), {
      duplicateGuardSpeakerId: "user-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A repeated evaluator run commonly encounters the proposal after the
    // first run accepted it; workflow state must not defeat content identity.
    state.submissions[0].status = "approved";
    const repeated = await save(state.repos, answers(), {
      duplicateGuardSpeakerId: first.primarySpeaker.id,
    });

    expect(repeated).toEqual({
      ok: false,
      error:
        "You've already submitted this proposal on this form. Open your speaker portal to update it instead.",
    });
    expect(state.submissions).toHaveLength(1);
  });

  it("does not treat an unauthenticated email field as proven identity", async () => {
    const state = fakeRepos();
    await save(state.repos, answers());
    const repeated = await save(state.repos, answers());

    expect(repeated.ok).toBe(true);
    expect(state.submissions).toHaveLength(2);
  });

  it("allows drafts and updates to keep their existing semantics", async () => {
    const state = fakeRepos();
    const draft = await save(state.repos, answers(), {
      status: "draft",
      duplicateGuardSpeakerId: "user-1",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const promoted = await save(state.repos, answers(), {
      submissionId: draft.submission.id,
      status: "submitted",
      duplicateGuardSpeakerId: draft.primarySpeaker.id,
    });

    expect(promoted.ok).toBe(true);
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0].status).toBe("submitted");
  });

  it("allows a genuinely changed proposal from the same signed-in speaker", async () => {
    const state = fakeRepos();
    const first = await save(state.repos, answers(), {
      duplicateGuardSpeakerId: "user-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const different = await save(
      state.repos,
      answers({ description: "A new practitioner story about a different system." }),
      { duplicateGuardSpeakerId: first.primarySpeaker.id },
    );

    expect(different.ok).toBe(true);
    expect(state.submissions).toHaveLength(2);
  });

  it("allows a withdrawn proposal to be submitted again", async () => {
    const state = fakeRepos();
    const first = await save(state.repos, answers(), {
      duplicateGuardSpeakerId: "user-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    state.submissions[0].status = "withdrawn";
    const replacement = await save(state.repos, answers(), {
      duplicateGuardSpeakerId: first.primarySpeaker.id,
    });

    expect(replacement.ok).toBe(true);
    expect(state.submissions).toHaveLength(2);
  });

  it("compares JSON answer objects independent of key insertion order", () => {
    expect(
      isIdenticalSubmittedProposal(
        {
          title: "Same talk",
          description: "Same abstract",
          answers: { speaker: { email: "p@example.test", name: "Priya" }, level: "Advanced" },
          status: "submitted",
        },
        {
          title: "Same talk",
          description: "Same abstract",
          answers: { level: "Advanced", speaker: { name: "Priya", email: "p@example.test" } },
        },
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drafts (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

describe("saving a draft", () => {
  it("keeps a half-finished proposal that the finished form would reject", async () => {
    const { repos } = fakeRepos();
    const result = await save(
      repos,
      { speaker_email: "priya@example.test", title: "Half an idea" },
      { status: "draft" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submission.status).toBe("draft");
    expect(result.submission.title).toBe("Half an idea");
  });

  it("gives every draft its own resume secret", async () => {
    const { repos } = fakeRepos();
    const first = await save(repos, answers(), { status: "draft" });
    const second = await save(
      repos,
      answers({ title: "Another one" }),
      { status: "draft" },
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.submission.resumeToken).toBeTruthy();
    expect(second.submission.resumeToken).not.toBe(first.submission.resumeToken);
  });

  it("hands a finished submission no resume token at all", async () => {
    const { repos } = fakeRepos();
    const result = await save(repos, answers());
    expect(result.ok && result.submission.resumeToken).toBeNull();
  });

  it("mints tokens long enough to be worth using as authentication", () => {
    // The link *is* the login, so the secret has to be magic-link grade.
    expect(newResumeToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(newResumeToken()).not.toBe(newResumeToken());
  });

  it("promotes a draft to submitted, keeping the link already in the inbox alive", async () => {
    const { repos } = fakeRepos();
    const draft = await save(repos, answers(), { status: "draft" });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const promoted = await save(repos, answers(), {
      submissionId: draft.submission.id,
      status: "submitted",
    });

    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.submission.id).toBe(draft.submission.id);
    expect(promoted.submission.status).toBe("submitted");
    expect(promoted.submission.resumeToken).toBe(draft.submission.resumeToken);
  });

  it("refuses to demote a proposal the committee already has", async () => {
    // The submitter owns exactly one status change — finishing their draft.
    // Editing an approved talk must never pull it back out of the queue.
    const { repos } = fakeRepos();
    const sent = await save(repos, answers());
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const edited = await save(repos, answers({ title: "Retitled" }), {
      submissionId: sent.submission.id,
      status: "draft",
    });

    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.submission.status).toBe("submitted");
    expect(edited.submission.title).toBe("Retitled");
  });

  it("still refuses a draft answer that could never be submitted", async () => {
    const { repos } = fakeRepos();
    const result = await save(repos, { speaker_email: "not-an-address" }, { status: "draft" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toHaveProperty("speaker_email");
  });
});

// ---------------------------------------------------------------------------
// Per-speaker limits (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

describe("speakerLimitState", () => {
  it("gives a first-time submitter a clean slate", async () => {
    const { repos } = fakeRepos();
    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "stranger@example.test",
    );
    expect(state).toEqual({ limit: 1, used: 0, remaining: 1, atLimit: false });
  });

  it("counts what this speaker already sent to this form", async () => {
    const { repos } = fakeRepos();
    await save(repos, answers());

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "priya@example.test",
    );
    expect(state.atLimit).toBe(true);
  });

  it("is blind to case and stray spaces in the address", async () => {
    const { repos } = fakeRepos();
    await save(repos, answers());

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "  Priya@Example.test ",
    );
    expect(state.atLimit).toBe(true);
  });

  it("doesn't hold a speaker's own draft against them when they finish it", async () => {
    const { repos } = fakeRepos();
    const draft = await save(repos, answers(), { status: "draft" });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "priya@example.test",
      { excludeId: draft.submission.id },
    );
    expect(state.atLimit).toBe(false);
  });

  it("doesn't spend a slot on being someone else's co-speaker", async () => {
    const { repos } = fakeRepos();
    await save(
      repos,
      answers({
        speaker_email: "dan@example.test",
        speaker_name: "Dan",
        co_speakers: [{ name: "Priya Raman", email: "priya@example.test", title: "", company: "" }],
      }),
    );

    const state = await speakerLimitState(
      { repos },
      form({ maxSubmissionsPerSpeaker: 1 }),
      "priya@example.test",
    );
    expect(state.used).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Keeping an accepted submission's session speakers in step (spec.md §5, §8)
// ---------------------------------------------------------------------------

/** An `approved` submission with a session already converted from it — the
 * state a speaker's edit lands in after acceptance. */
function approvedSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "submission-1",
    eventId: "event-1",
    formId: "form-1",
    title: "Retrieval that survives production traffic",
    description: "A practitioner story.",
    answers: {},
    status: "approved",
    resumeToken: null,
    decidedBy: "admin-1",
    decidedAt: NOW,
    decisionNote: null,
    ...timestamps(),
    ...overrides,
  };
}

describe("editing speakers on an already-accepted submission", () => {
  it("adds a co-speaker saved after acceptance to the session, not just the submission", async () => {
    const primary = speaker();
    const { repos, sessionSpeakerLinks } = fakeRepos({
      submissions: [approvedSubmission()],
      users: [primary],
      sessions: [session({ submissionId: "submission-1" })],
    });

    const result = await save(
      repos,
      answers({
        co_speakers: [{ name: "Dan Cho", email: "dan@example.test", title: "", company: "" }],
      }),
      { submissionId: "submission-1" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dan = await repos.users.getByEmail("dan@example.test");
    expect(dan).not.toBeNull();
    // The layer that already keeps a session's speakers in sync on acceptance
    // (`sessions.setSpeakers` in src/domain/review.ts) is the one this reuses:
    // without it, the co-speaker would be linked on `submission_speakers` only,
    // and both Admin > Speakers and the public gallery read the session's
    // speakers — the co-speaker would be untrackable and invisible on both.
    expect(sessionSpeakerLinks["session-1"]).toEqual([primary.id, dan?.id]);
  });

  it("drops a removed co-speaker from the session too", async () => {
    const primary = speaker();
    const { repos, sessionSpeakerLinks } = fakeRepos({
      submissions: [approvedSubmission()],
      users: [primary],
      sessions: [session({ submissionId: "submission-1" })],
    });

    // First save adds the co-speaker (and the session picks them up)...
    await save(
      repos,
      answers({
        co_speakers: [{ name: "Dan Cho", email: "dan@example.test", title: "", company: "" }],
      }),
      { submissionId: "submission-1" },
    );
    // ...the next save drops them again.
    await save(repos, answers({ co_speakers: [] }), { submissionId: "submission-1" });

    expect(sessionSpeakerLinks["session-1"]).toEqual([primary.id]);
  });

  it("leaves the session untouched before the submission has one", async () => {
    // Nothing to sync yet — acceptance hasn't run, so there is no session.
    const { repos, sessionSpeakerLinks } = fakeRepos();

    const result = await save(
      repos,
      answers({
        co_speakers: [{ name: "Dan Cho", email: "dan@example.test", title: "", company: "" }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(sessionSpeakerLinks)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Onboarding for a speaker added after acceptance (spec.md §5, decisions.md
// D-069) — acceptance hands out the auto-assign tasks, so a co-speaker who
// arrives later must not end up with different onboarding for the same talk.
// ---------------------------------------------------------------------------

describe("auto-assigned tasks for a co-speaker added after acceptance", () => {
  const CO_SPEAKER = [{ name: "Dan Cho", email: "dan@example.test", title: "", company: "" }];

  function acceptedTalk(seed: Partial<Parameters<typeof fakeRepos>[0]> = {}) {
    return fakeRepos({
      submissions: [approvedSubmission()],
      users: [speaker()],
      sessions: [session({ submissionId: "submission-1" })],
      tasks: [task(), task({ id: "task-2", title: "Confirm your slot", type: "confirm" })],
      ...seed,
    });
  }

  it("hands the new co-speaker every auto-assign task on the event", async () => {
    const { repos, taskAssignments } = acceptedTalk();

    await save(repos, answers({ co_speakers: CO_SPEAKER }), { submissionId: "submission-1" });

    const dan = await repos.users.getByEmail("dan@example.test");
    expect(taskAssignments.filter((row) => row.speakerId === dan?.id).map((row) => row.taskId).sort())
      .toEqual(["task-1", "task-2"]);
  });

  it("never duplicates an assignment or resets a completed one", async () => {
    const { repos, taskAssignments } = acceptedTalk();
    await save(repos, answers({ co_speakers: CO_SPEAKER }), { submissionId: "submission-1" });

    // The speaker finishes one of them, then edits the proposal again.
    const done = taskAssignments.find((row) => row.taskId === "task-1")!;
    done.status = "completed";
    done.completedAt = NOW;

    await save(repos, answers({ co_speakers: CO_SPEAKER, title: "Retitled" }), {
      submissionId: "submission-1",
    });

    expect(taskAssignments).toHaveLength(4); // two speakers x two tasks, once each
    expect(taskAssignments.find((row) => row.id === done.id)).toMatchObject({
      status: "completed",
      completedAt: NOW,
    });
  });

  it("leaves a task that isn't auto-assign-on-accept alone", async () => {
    const { repos, taskAssignments } = acceptedTalk({
      tasks: [task({ autoAssignOnAccept: false })],
    });

    await save(repos, answers({ co_speakers: CO_SPEAKER }), { submissionId: "submission-1" });

    expect(taskAssignments).toHaveLength(0);
  });

  it("assigns nothing on a talk whose acceptance was reversed", async () => {
    // A cancelled session is a withdrawn acceptance (`cancelSession`,
    // src/domain/review.ts) — nobody is owed onboarding for it.
    const { repos, taskAssignments } = acceptedTalk({
      submissions: [approvedSubmission({ status: "denied" })],
      sessions: [session({ submissionId: "submission-1", status: "cancelled" })],
    });

    await save(repos, answers({ co_speakers: CO_SPEAKER }), { submissionId: "submission-1" });

    expect(taskAssignments).toHaveLength(0);
  });

  it("assigns nothing while the proposal is still in front of the committee", async () => {
    // Belt and braces against a half-finished decision: a submission that
    // isn't approved owes nobody onboarding even if a session row survives
    // beside it.
    const { repos, taskAssignments } = acceptedTalk({
      submissions: [approvedSubmission({ status: "maybe" })],
    });

    await save(repos, answers({ co_speakers: CO_SPEAKER }), { submissionId: "submission-1" });

    expect(taskAssignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Speaker edits to an accepted abstract (decisions.md D-071 — revision history
// covers organizer- *and* speaker-driven edits)
// ---------------------------------------------------------------------------

describe("editing the abstract of an already-accepted submission", () => {
  function acceptedTalk(sessionOverrides: Partial<Session> = {}) {
    return fakeRepos({
      submissions: [approvedSubmission()],
      users: [speaker()],
      sessions: [
        session({
          submissionId: "submission-1",
          description: "A practitioner story.",
          ...sessionOverrides,
        }),
      ],
    });
  }

  it("carries the new abstract onto the session and appends a revision", async () => {
    const { repos, sessions, sessionRevisions } = acceptedTalk();

    await save(repos, answers({ description: "A rewritten practitioner story." }), {
      submissionId: "submission-1",
    });

    expect(sessions[0].description).toBe("A rewritten practitioner story.");
    expect(sessionRevisions).toHaveLength(1);
    expect(sessionRevisions[0]).toMatchObject({
      sessionId: "session-1",
      field: "abstract",
      priorValue: "A practitioner story.",
      newValue: "A rewritten practitioner story.",
      // The speaker who saved it, not the admin who accepted it.
      authorUserId: "user-1",
    });
  });

  it("writes no revision when the save left the abstract as it was", async () => {
    const { repos, sessionRevisions } = acceptedTalk();

    await save(repos, answers({ description: "A practitioner story." }), {
      submissionId: "submission-1",
    });

    expect(sessionRevisions).toHaveLength(0);
  });

  it("leaves an organizer's retitled session title alone", async () => {
    // D-071 scopes history to abstracts, so a title synced from the proposal
    // would silently overwrite the programme's own wording with nothing to
    // notice it by.
    const { repos, sessions } = acceptedTalk({ title: "Retrieval in production (main stage)" });

    await save(repos, answers({ title: "Whatever the speaker types now" }), {
      submissionId: "submission-1",
    });

    expect(sessions[0].title).toBe("Retrieval in production (main stage)");
  });

  it("doesn't touch a cancelled session", async () => {
    const { repos, sessions, sessionRevisions } = acceptedTalk({ status: "cancelled" });

    await save(repos, answers({ description: "A rewritten practitioner story." }), {
      submissionId: "submission-1",
    });

    expect(sessions[0].description).toBe("A practitioner story.");
    expect(sessionRevisions).toHaveLength(0);
  });

  it("records a first abstract with a null prior value", async () => {
    const { repos, sessionRevisions } = acceptedTalk({ description: null });

    await save(repos, answers({ description: "The abstract, at last." }), {
      submissionId: "submission-1",
    });

    expect(sessionRevisions[0]).toMatchObject({
      priorValue: null,
      newValue: "The abstract, at last.",
    });
  });
});

// ---------------------------------------------------------------------------
// updateSubmissionTracks (a submission with zero tracks is unreachable by
// every reviewer — isRoutedToReviewer in src/domain/review.ts — so an admin
// must be able to repair its routing after intake)
// ---------------------------------------------------------------------------

describe("updateSubmissionTracks", () => {
  const OTHER_TRACK: Track = {
    id: "track-2",
    eventId: "event-1",
    name: "Platform",
    color: null,
    ...timestamps(),
  };

  /** A form that never asks the reserved tracks question at all — the exact
   * shape that leaves a submission with zero `submission_tracks` rows, since
   * `selectedTrackNames` (src/domain/forms.ts) finds no track field to read
   * an answer from. */
  function formWithoutTracksQuestion(): Form {
    return form({ fields: DEFAULT_CFP_FIELDS.filter((f) => f.id !== RESERVED_FIELD_IDS.tracks) });
  }

  async function submissionWithNoTracks(extraTracks: Track[] = []) {
    const { repos, submissions } = fakeRepos({ tracks: [...TRACKS, ...extraTracks] });
    const result = await saveSubmission(
      { repos },
      {
        form: formWithoutTracksQuestion(),
        event: event(),
        tracks: TRACKS,
        values: answers(),
        status: "submitted",
      },
    );
    if (!result.ok) throw new Error("fixture submission failed to save");
    return { repos, submissions, submissionId: result.submission.id };
  }

  it("routes a track-less submission to a reviewer by writing its tracks", async () => {
    const { repos, submissionId } = await submissionWithNoTracks();

    const result = await updateSubmissionTracks({ repos }, submissionId, [TRACKS[0].id]);

    expect(result).toEqual({ ok: true });
    const trackLinks = await repos.submissions.listTrackIds(submissionId);
    expect(trackLinks).toEqual([TRACKS[0].id]);
  });

  it("writes more than one track and de-duplicates repeats", async () => {
    const { repos, submissionId } = await submissionWithNoTracks([OTHER_TRACK]);

    await updateSubmissionTracks({ repos }, submissionId, [
      TRACKS[0].id,
      OTHER_TRACK.id,
      TRACKS[0].id,
    ]);

    const trackLinks = await repos.submissions.listTrackIds(submissionId);
    expect(trackLinks.sort()).toEqual([OTHER_TRACK.id, TRACKS[0].id].sort());
  });

  it("drops a track id that isn't on this submission's event", async () => {
    const { repos, submissionId } = await submissionWithNoTracks();

    const result = await updateSubmissionTracks({ repos }, submissionId, [
      TRACKS[0].id,
      "track-from-another-event",
    ]);

    expect(result).toEqual({ ok: true });
    const trackLinks = await repos.submissions.listTrackIds(submissionId);
    expect(trackLinks).toEqual([TRACKS[0].id]);
  });

  it("can clear a submission back to no tracks", async () => {
    const { repos, submissionId } = await submissionWithNoTracks();
    await updateSubmissionTracks({ repos }, submissionId, [TRACKS[0].id]);

    await updateSubmissionTracks({ repos }, submissionId, []);

    const trackLinks = await repos.submissions.listTrackIds(submissionId);
    expect(trackLinks).toEqual([]);
  });

  it("reports failure for a submission that doesn't exist", async () => {
    const { repos } = fakeRepos({ tracks: TRACKS });
    const result = await updateSubmissionTracks({ repos }, "no-such-submission", [TRACKS[0].id]);
    expect(result).toEqual({ ok: false, error: "Submission not found" });
  });
});

describe("matchesSubmissionSearch", () => {
  it("matches on title, case- and whitespace-insensitively", () => {
    const row = { title: "Scaling Vector Search", speakerNames: ["Priya Raman"] };
    expect(matchesSubmissionSearch(row, "  VECTOR  ")).toBe(true);
    expect(matchesSubmissionSearch(row, "graphql")).toBe(false);
  });

  it("matches on any speaker's name", () => {
    const row = { title: "Scaling Vector Search", speakerNames: ["Priya Raman", "Dan Cho"] };
    expect(matchesSubmissionSearch(row, "dan")).toBe(true);
  });

  it("treats an empty or blank query as matching everything", () => {
    const row = { title: "Anything", speakerNames: [] };
    expect(matchesSubmissionSearch(row, "")).toBe(true);
    expect(matchesSubmissionSearch(row, "   ")).toBe(true);
  });

  it("never matches a name a blind row already withheld", () => {
    // The queue loader empties `speakerNames` for a blind row (D-049) before
    // this ever runs - searching the speaker's name then finds nothing,
    // which is the point: blindness must hold for the search box too.
    const row = { title: "Scaling Vector Search", speakerNames: [] };
    expect(matchesSubmissionSearch(row, "priya")).toBe(false);
  });
});

describe("countSubmissionsByStatus", () => {
  it("tallies each status, including zero for statuses absent from the input", () => {
    expect(
      countSubmissionsByStatus(["submitted", "submitted", "approved", "denied", "denied", "denied"]),
    ).toEqual({
      draft: 0,
      submitted: 2,
      approved: 1,
      maybe: 0,
      denied: 3,
      withdrawn: 0,
    });
  });

  it("returns all-zero counts for an empty queue", () => {
    expect(countSubmissionsByStatus([])).toEqual({
      draft: 0,
      submitted: 0,
      approved: 0,
      maybe: 0,
      denied: 0,
      withdrawn: 0,
    });
  });
});

describe("queuePosition", () => {
  const ids = ["a", "b", "c", "d"];

  it("reads out a 1-based position in the queue, with both neighbours", () => {
    expect(queuePosition(ids, "b")).toEqual({
      position: 2,
      total: 4,
      previousId: "a",
      nextId: "c",
    });
  });

  it("has nowhere to go back to on the first record", () => {
    expect(queuePosition(ids, "a")).toEqual({
      position: 1,
      total: 4,
      previousId: null,
      nextId: "b",
    });
  });

  it("has nowhere to go forward to on the last record", () => {
    expect(queuePosition(ids, "d")).toEqual({
      position: 4,
      total: 4,
      previousId: "c",
      nextId: null,
    });
  });

  it("gives a single-record queue no neighbours at all", () => {
    expect(queuePosition(["only"], "only")).toEqual({
      position: 1,
      total: 1,
      previousId: null,
      nextId: null,
    });
  });

  it("returns null for a record the queue never contained", () => {
    // Rather than inventing a position: a record outside this viewer's queue
    // has no place in it, and the page shows no pager.
    expect(queuePosition(ids, "nope")).toBeNull();
    expect(queuePosition([], "a")).toBeNull();
  });
});
