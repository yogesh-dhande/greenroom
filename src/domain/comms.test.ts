import { describe, expect, it } from "vitest";
import type {
  EmailLog,
  Event,
  Form,
  NewEmailLog,
  ReviewRound,
  RoundAssignment,
  RoundScore,
  Session,
  Submission,
  Task,
  TaskAssignment,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import type { EmailSender } from "@/lib/email";
import {
  buildCommunicationLog,
  type CommsContext,
  decideDraftReminder,
  decideTaskDigest,
  DRAFT_REMINDER_WINDOW_HOURS,
  eventFields,
  filterCommunicationLog,
  inviteBlocker,
  isTaskDigestWindow,
  MANUAL_TASK_DIGEST_COOLDOWN_HOURS,
  previewTaskDigestCount,
  runReminderJob,
  sendRoundReminders,
  sendTeamInvite,
  summarizeSessionInvites,
  TASK_DIGEST_COOLDOWN_DAYS,
  taskDigestLogId,
  type DraftReminderDecisionInput,
  type TaskDigestDecisionInput,
} from "@/domain/comms";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-01T17:00:00.000Z");
/**
 * The one cron tick a week the digest goes out: Monday 2026-05-04, 07:00 UTC
 * (D-039). Every scheduled-digest test runs at this instant, because every
 * other instant is a no-op by design.
 */
const MONDAY = new Date("2026-05-04T07:05:00.000Z");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function timestamps() {
  return { createdAt: NOW, updatedAt: NOW };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    name: "AI Engineer Summit 2026",
    slug: "aie-2026",
    description: null,
    startDate: "2026-06-16",
    endDate: "2026-06-18",
    timezone: "America/Los_Angeles",
    location: "Moscone West",
    programPublished: true,
    ...timestamps(),
    ...overrides,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "priya@example.test",
    emailVerified: true,
    name: "Priya Raman",
    role: "speaker",
    title: null,
    company: null,
    bio: null,
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
    title: "Upload your headshot",
    instructions: null,
    type: "file_request",
    formId: null,
    dueAt: new Date(NOW.getTime() + 2 * DAY),
    autoAssignOnAccept: true,
    ...timestamps(),
    ...overrides,
  };
}

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: "assignment-1",
    taskId: "task-1",
    speakerId: "user-1",
    status: "pending",
    completedAt: null,
    responseJson: null,
    fileUrl: null,
    ...timestamps(),
    ...overrides,
  };
}

function logEntry(overrides: Partial<EmailLog> = {}): EmailLog {
  return {
    id: "log-1",
    to: "priya@example.test",
    subject: "Reminder: Upload your headshot",
    // `task_reminder` is the retired per-task nudge (D-039). Its rows are
    // still in everyone's history, so the log helpers have to keep reading it.
    kind: "task_reminder",
    relatedType: "task_assignment",
    relatedId: "assignment-1",
    status: "sent",
    error: null,
    sentAt: NOW,
    ...overrides,
  };
}

/**
 * A digest that already went out, with an **explicit** `sentAt`.
 *
 * The logging sender stamps rows with the wall clock rather than the job's
 * simulated `now` (docs/learnings.md), so anything testing the cooldown has to
 * seed its own history rather than send twice and hope.
 */
function digestLog(sentAt: Date, overrides: Partial<EmailLog> = {}): EmailLog {
  return logEntry({
    id: `digest-${sentAt.getTime()}`,
    subject: "Still on your AI Engineer Summit 2026 speaker checklist",
    kind: "task_digest",
    relatedType: "user",
    relatedId: taskDigestLogId("event-1", "user-1"),
    sentAt,
    ...overrides,
  });
}

const HOUR = 60 * 60 * 1000;

function form(overrides: Partial<Form> = {}): Form {
  return {
    id: "form-1",
    eventId: "event-1",
    name: "Call for Speakers",
    slug: "aie-2026-cfp",
    type: "abstract",
    welcomeCopy: null,
    fields: [],
    opensAt: null,
    closesAt: new Date(NOW.getTime() + 12 * HOUR),
    confirmationPageContent: null,
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    isPublished: true,
    ...timestamps(),
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "submission-1",
    eventId: "event-1",
    formId: "form-1",
    title: "Shipping agents that don't page you at 3am",
    description: null,
    answers: {},
    status: "draft",
    resumeToken: "resume-token-1",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    ...timestamps(),
    ...overrides,
  };
}

function draftReminderInput(
  overrides: Partial<DraftReminderDecisionInput> = {},
): DraftReminderDecisionInput {
  return {
    status: "draft",
    closesAt: new Date(NOW.getTime() + 12 * HOUR),
    alreadyReminded: false,
    now: NOW,
    ...overrides,
  };
}

function digestInput(overrides: Partial<TaskDigestDecisionInput> = {}): TaskDigestDecisionInput {
  return {
    outstandingCount: 2,
    eventStartDate: "2026-06-16",
    timezone: "America/Los_Angeles",
    lastDigestAt: null,
    now: MONDAY,
    cooldownMs: TASK_DIGEST_COOLDOWN_DAYS * DAY,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A repository double
// ---------------------------------------------------------------------------

/**
 * Just enough of the repository layer for `runReminderJob`, backed by arrays.
 *
 * The job's whole contract is "which of these assignments gets an email", so
 * running it against in-memory rows exercises the real code path — including
 * the `email_log` writes it reads back on the next run, which is what makes
 * the cooldown testable at all.
 */
function fakeRepos(seed: {
  events: Event[];
  tasks: Task[];
  assignments: TaskAssignment[];
  users: User[];
  emailLog?: EmailLog[];
  forms?: Form[];
  submissions?: Submission[];
  /** submission id → speaker ids, primary first. */
  submissionSpeakers?: Record<string, string[]>;
}) {
  const emails: EmailLog[] = [...(seed.emailLog ?? [])];
  const forms = seed.forms ?? [];
  const submissions = seed.submissions ?? [];
  const speakerLinks = seed.submissionSpeakers ?? {};

  const repos = {
    forms: {
      getById: async (id: string) => forms.find((row) => row.id === id) ?? null,
    },
    submissions: {
      listAllByStatus: async (status: string) =>
        submissions.filter((row) => row.status === status),
      getById: async (id: string) => submissions.find((row) => row.id === id) ?? null,
      listSpeakers: async (submissionId: string) =>
        (speakerLinks[submissionId] ?? []).map((userId, index) => ({
          submissionId,
          userId,
          role: index === 0 ? "primary" : "co",
        })),
    },
    events: {
      listAll: async () => seed.events,
      getById: async (id: string) => seed.events.find((row) => row.id === id) ?? null,
    },
    tasks: {
      listByEvent: async (eventId: string) =>
        seed.tasks.filter((row) => row.eventId === eventId),
      getById: async (id: string) => seed.tasks.find((row) => row.id === id) ?? null,
    },
    taskAssignments: {
      listByEvent: async (eventId: string) => {
        const taskIds = new Set(
          seed.tasks.filter((row) => row.eventId === eventId).map((row) => row.id),
        );
        return seed.assignments.filter((row) => taskIds.has(row.taskId));
      },
      listBySpeaker: async (speakerId: string) =>
        seed.assignments.filter((row) => row.speakerId === speakerId),
      getById: async (id: string) => seed.assignments.find((row) => row.id === id) ?? null,
    },
    users: {
      getById: async (id: string) => seed.users.find((row) => row.id === id) ?? null,
      listByIds: async (ids: string[]) => seed.users.filter((row) => ids.includes(row.id)),
    },
    emailTemplates: {
      listByEvent: async () => [],
    },
    emailLog: {
      create: async (row: NewEmailLog) => {
        const created: EmailLog = { id: `log-${emails.length + 1}`, ...row };
        emails.push(created);
        return created;
      },
      listByRelatedIds: async (relatedType: string, relatedIds: string[]) =>
        emails.filter(
          (row) => row.relatedType === relatedType && relatedIds.includes(row.relatedId ?? ""),
        ),
    },
  };

  return { repos: repos as unknown as Repos, emails };
}

/** Records what it was asked to send instead of sending it. */
function fakeSender() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const sender: EmailSender = {
    from: { name: "Greenroom", email: "hello@greenroom.test" },
    async send(message) {
      sent.push({ to: message.to, subject: message.subject, text: message.text });
      return { id: `msg-${sent.length}` };
    },
  };
  return { sender, sent };
}

// ---------------------------------------------------------------------------
// eventFields - the {{organizerEmail}} merge token (no-reply leak fix)
// ---------------------------------------------------------------------------

describe("eventFields - {{organizerEmail}}", () => {
  it("falls back to the transport's From address for an automated send (no viewer in context)", () => {
    const { sender } = fakeSender();
    const ctx: CommsContext = { repos: {} as Repos, sender, appUrl: "https://example.com", now: NOW };

    const fields = eventFields(ctx, event());

    expect(fields.organizerEmail).toBe(sender.from.email);
  });

  it("uses the signed-in viewer's own address when an admin-initiated send set one", () => {
    const { sender } = fakeSender();
    const ctx: CommsContext = {
      repos: {} as Repos,
      sender,
      appUrl: "https://example.com",
      now: NOW,
      organizerEmail: "priya@example.test",
    };

    const fields = eventFields(ctx, event());

    expect(fields.organizerEmail).toBe("priya@example.test");
    // The whole point of the fix: a real send must not resolve to the
    // no-reply transport address just because it's always in context.
    expect(fields.organizerEmail).not.toBe(sender.from.email);
  });
});

// ---------------------------------------------------------------------------
// isTaskDigestWindow — the weekly schedule on a 15-minute cron (D-039)
// ---------------------------------------------------------------------------

describe("isTaskDigestWindow", () => {
  it("opens for the run scheduled at Monday 07:00 UTC", () => {
    expect(isTaskDigestWindow(new Date("2026-05-04T07:00:00.000Z"))).toBe(true);
  });

  it("stays open for a run that fires late inside the same quarter hour", () => {
    // Cron ticks aren't punctual; a run at 07:14 is still *the* 07:00 run.
    expect(isTaskDigestWindow(new Date("2026-05-04T07:14:59.000Z"))).toBe(true);
  });

  it("closes for the next tick", () => {
    // 07:15 must not send a second digest — otherwise the four runs of the
    // hour would each mail the whole roster.
    expect(isTaskDigestWindow(new Date("2026-05-04T07:15:00.000Z"))).toBe(false);
    expect(isTaskDigestWindow(new Date("2026-05-04T06:59:59.000Z"))).toBe(false);
  });

  it("stays shut every other day of the week", () => {
    // Same hour, wrong day: Sunday, Tuesday, and the Friday `NOW`.
    expect(isTaskDigestWindow(new Date("2026-05-03T07:05:00.000Z"))).toBe(false);
    expect(isTaskDigestWindow(new Date("2026-05-05T07:05:00.000Z"))).toBe(false);
    expect(isTaskDigestWindow(NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideTaskDigest — who gets this week's digest (decisions.md D-039)
// ---------------------------------------------------------------------------

describe("decideTaskDigest", () => {
  it("sends to a speaker with work still open", () => {
    expect(decideTaskDigest(digestInput())).toEqual({ send: true });
  });

  it("says nothing at all to a speaker whose checklist is clear", () => {
    expect(decideTaskDigest(digestInput({ outstandingCount: 0 }))).toEqual({
      send: false,
      reason: "nothing_outstanding",
    });
  });

  it("stops once the event has started", () => {
    // The event begins on 2026-06-16 in Los Angeles; "now" is the day after.
    expect(decideTaskDigest(digestInput({ now: new Date("2026-06-17T12:00:00.000Z") }))).toEqual({
      send: false,
      reason: "event_started",
    });
  });

  it("treats the event's start as midnight in the event's own timezone", () => {
    // 2026-06-16T05:00Z is 10pm on the 15th in Los Angeles — still before the
    // event begins, even though UTC has already ticked over to the 16th.
    expect(decideTaskDigest(digestInput({ now: new Date("2026-06-16T05:00:00.000Z") })).send).toBe(
      true,
    );
    expect(decideTaskDigest(digestInput({ now: new Date("2026-06-16T08:00:00.000Z") }))).toEqual({
      send: false,
      reason: "event_started",
    });
  });

  it("still sends for an event with no start date on the calendar", () => {
    expect(decideTaskDigest(digestInput({ eventStartDate: null })).send).toBe(true);
  });

  it("holds off while the last digest is still recent", () => {
    expect(
      decideTaskDigest(digestInput({ lastDigestAt: new Date(MONDAY.getTime() - 1 * DAY) })),
    ).toEqual({ send: false, reason: "cooldown" });
    expect(
      decideTaskDigest(digestInput({ lastDigestAt: new Date(MONDAY.getTime() - 5.9 * DAY) })),
    ).toEqual({ send: false, reason: "cooldown" });
  });

  it("lets the next Monday through", () => {
    // The point of a six-day cooldown on a seven-day cadence: a week later is
    // comfortably outside it, even if the cron drifts by an hour.
    expect(
      decideTaskDigest(digestInput({ lastDigestAt: new Date(MONDAY.getTime() - 7 * DAY) })).send,
    ).toBe(true);
  });

  it("lets a manual send through after a day, on the shorter cooldown", () => {
    const yesterday = new Date(MONDAY.getTime() - 25 * 60 * 60 * 1000);
    const manual = MANUAL_TASK_DIGEST_COOLDOWN_HOURS * 60 * 60 * 1000;

    expect(decideTaskDigest(digestInput({ lastDigestAt: yesterday, cooldownMs: manual })).send).toBe(
      true,
    );
    // The same history on the scheduled cooldown is still inside it.
    expect(decideTaskDigest(digestInput({ lastDigestAt: yesterday }))).toEqual({
      send: false,
      reason: "cooldown",
    });
  });

  it("reports 'nothing outstanding' ahead of every other reason", () => {
    // A cleared checklist after the event started, inside a cooldown, is still
    // reported as clear — that's the reason an organizer would want to read.
    expect(
      decideTaskDigest(
        digestInput({
          outstandingCount: 0,
          now: new Date("2026-06-20T12:00:00.000Z"),
          lastDigestAt: NOW,
        }),
      ),
    ).toEqual({ send: false, reason: "nothing_outstanding" });
  });
});

// ---------------------------------------------------------------------------
// decideDraftReminder — the form-closing nudge (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

describe("decideDraftReminder", () => {
  it("nudges an unfinished draft on a form closing inside the window", () => {
    expect(decideDraftReminder(draftReminderInput())).toEqual({ send: true });
  });

  it("says nothing about a proposal that was actually submitted", () => {
    expect(decideDraftReminder(draftReminderInput({ status: "submitted" }))).toEqual({
      send: false,
      reason: "completed",
    });
  });

  it("says nothing about a draft on a call with no closing date", () => {
    expect(decideDraftReminder(draftReminderInput({ closesAt: null }))).toEqual({
      send: false,
      reason: "not_due",
    });
  });

  it("waits until the close is inside the window", () => {
    const wellAhead = new Date(NOW.getTime() + (DRAFT_REMINDER_WINDOW_HOURS + 6) * 60 * 60 * 1000);
    expect(decideDraftReminder(draftReminderInput({ closesAt: wellAhead }))).toEqual({
      send: false,
      reason: "not_due",
    });

    const justInside = new Date(NOW.getTime() + (DRAFT_REMINDER_WINDOW_HOURS - 1) * 60 * 60 * 1000);
    expect(decideDraftReminder(draftReminderInput({ closesAt: justInside })).send).toBe(true);
  });

  it("doesn't chase a draft once the call has closed", () => {
    // Unlike a task, which stays actionable when overdue, a draft on a closed
    // form can't be submitted — the email would only be bad news.
    expect(
      decideDraftReminder(draftReminderInput({ closesAt: new Date(NOW.getTime() - HOUR) })),
    ).toEqual({ send: false, reason: "closed" });
  });

  it("only ever nudges once", () => {
    expect(decideDraftReminder(draftReminderInput({ alreadyReminded: true }))).toEqual({
      send: false,
      reason: "cooldown",
    });
  });
});

// ---------------------------------------------------------------------------
// runReminderJob
// ---------------------------------------------------------------------------

describe("runReminderJob", () => {
  const baseSeed = () => ({
    events: [event()],
    tasks: [task(), task({ id: "task-2", title: "Sign the speaker agreement" })],
    assignments: [
      assignment(),
      assignment({ id: "assignment-2", taskId: "task-2", status: "completed" }),
    ],
    users: [user()],
  });

  const draftSeed = () => ({
    events: [event()],
    tasks: [],
    assignments: [],
    users: [user()],
    forms: [form()],
    submissions: [submission()],
    submissionSpeakers: { "submission-1": ["user-1"] },
  });

  it("nudges a draft whose call is about to close", async () => {
    const { repos } = fakeRepos(draftSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW });

    expect(result.remindersSent).toBe(1);
    expect(result.sentTo).toEqual(["priya@example.test"]);
    expect(sent).toHaveLength(1);
  });

  it("never nudges the same draft twice, however often the cron runs", async () => {
    const { repos } = fakeRepos(draftSeed());
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: NOW });
    const second = await runReminderJob({ repos, sender, now: NOW });

    expect(sent).toHaveLength(1);
    expect(second.remindersSent).toBe(0);
    expect(second.skippedByReason.cooldown).toBe(1);
  });

  it("leaves drafts alone while the call still has weeks to run", async () => {
    const { repos } = fakeRepos({
      ...draftSeed(),
      forms: [form({ closesAt: new Date(NOW.getTime() + 20 * DAY) })],
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW });

    expect(sent).toHaveLength(0);
    expect(result.skippedByReason.not_due).toBe(1);
  });

  it("sends one digest listing everything still open, not one email per task", async () => {
    // The whole point of D-039: three outstanding tasks used to mean three
    // emails, and now means one that names all three.
    const { repos, emails } = fakeRepos({
      ...baseSeed(),
      tasks: [
        task(),
        task({ id: "task-2", title: "Sign the speaker agreement" }),
        task({
          id: "task-3",
          title: "Book your hotel",
          dueAt: new Date(NOW.getTime() + 20 * DAY),
        }),
      ],
      assignments: [
        assignment(),
        assignment({ id: "assignment-2", taskId: "task-2" }),
        assignment({ id: "assignment-3", taskId: "task-3" }),
      ],
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: MONDAY });

    expect(result.remindersSent).toBe(1);
    expect(result.remindersFailed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.sentTo).toEqual(["priya@example.test"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Upload your headshot");
    expect(sent[0].text).toContain("Sign the speaker agreement");
    expect(sent[0].text).toContain("Book your hotel");

    // The log row is what the next run's cooldown reads back, so its shape
    // matters as much as the email: one row, keyed on event + speaker.
    expect(emails).toHaveLength(1);
    expect(emails[0].kind).toBe("task_digest");
    expect(emails[0].relatedType).toBe("user");
    expect(emails[0].relatedId).toBe(taskDigestLogId("event-1", "user-1"));
  });

  it("leaves finished work off the list", async () => {
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: MONDAY });

    expect(result.remindersSent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Upload your headshot");
    expect(sent[0].text).not.toContain("Sign the speaker agreement");
  });

  it("says nothing to a speaker whose checklist is clear", async () => {
    const seed = baseSeed();
    const { repos } = fakeRepos({
      ...seed,
      assignments: seed.assignments.map((row) => ({ ...row, status: "completed" as const })),
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: MONDAY });

    expect(sent).toHaveLength(0);
    expect(result.remindersSent).toBe(0);
    // One speaker considered and passed over, not two tasks — the digest
    // counts people, which is what the admin summary now reports.
    expect(result.skipped).toBe(1);
    expect(result.skippedByReason.nothing_outstanding).toBe(1);
  });

  it("does no digest work at all outside the Monday window", async () => {
    // NOW is a Friday afternoon: 671 of the week's 672 cron runs look like
    // this one, and they must not even read the roster.
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW });

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it("skips a speaker who already had a digest inside the cooldown", async () => {
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [digestLog(new Date(MONDAY.getTime() - 2 * DAY))],
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: MONDAY });

    expect(sent).toHaveLength(0);
    expect(result.skippedByReason.cooldown).toBe(1);
  });

  it("sends again the following Monday", async () => {
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [digestLog(new Date(MONDAY.getTime() - 7 * DAY))],
    });
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: MONDAY });

    expect(sent).toHaveLength(1);
  });

  it("keeps two events' digests independent", async () => {
    // A speaker on two programmes gets one digest per event. Keying the
    // cooldown on the speaker alone would let event A's Monday send silence
    // event B's forever.
    const { repos } = fakeRepos({
      events: [event(), event({ id: "event-2", slug: "other", name: "Other Conf" })],
      tasks: [task(), task({ id: "task-2", eventId: "event-2", title: "Send us your slides" })],
      assignments: [assignment(), assignment({ id: "assignment-2", taskId: "task-2" })],
      users: [user()],
      emailLog: [digestLog(new Date(MONDAY.getTime() - 2 * DAY))],
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: MONDAY });

    expect(result.skippedByReason.cooldown).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Send us your slides");
  });

  it("sends on demand outside the window when an admin asks", async () => {
    // The "Send task digest now" button: same function, `manual: true`.
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW, manual: true });

    expect(result.remindersSent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("won't let a double-click on the button mail a speaker twice", async () => {
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [digestLog(new Date(NOW.getTime() - 1 * 60 * 60 * 1000))],
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW, manual: true });

    expect(sent).toHaveLength(0);
    expect(result.skippedByReason.cooldown).toBe(1);
  });

  it("lets an admin re-send a day later, without waiting out the weekly cooldown", async () => {
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [digestLog(new Date(NOW.getTime() - 25 * 60 * 60 * 1000))],
    });
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: NOW, manual: true });

    expect(sent).toHaveLength(1);
  });

  it("goes quiet altogether once the event has started", async () => {
    // Monday 2026-06-22, 07:05 UTC — the digest's own window, six days after
    // the event opened.
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({
      repos,
      sender,
      now: new Date("2026-06-22T07:05:00.000Z"),
    });

    expect(sent).toHaveLength(0);
    expect(result.skippedByReason.event_started).toBe(1);
  });

  it("only touches the named event when one is given", async () => {
    const seed = baseSeed();
    const { repos } = fakeRepos({
      ...seed,
      events: [seed.events[0], event({ id: "event-2", slug: "other", name: "Other" })],
    });
    const { sender } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: MONDAY, eventId: "event-2" });

    expect(result.remindersSent).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("counts a failed delivery without claiming it was sent", async () => {
    const { repos } = fakeRepos(baseSeed());
    const sender: EmailSender = {
      from: { name: "Greenroom", email: "hello@greenroom.test" },
      async send() {
        throw new Error("transport is down");
      },
    };

    const result = await runReminderJob({ repos, sender, now: MONDAY });

    expect(result.remindersSent).toBe(0);
    expect(result.remindersFailed).toBe(1);
    expect(result.sentTo).toEqual([]);
  });

  it("retries after a failure rather than treating it as a digest sent", async () => {
    // The cooldown keys off successful sends only, so a bounced attempt
    // doesn't buy the speaker a week of silence.
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [
        digestLog(new Date(MONDAY.getTime() - 1 * DAY), {
          status: "failed",
          error: "transport is down",
        }),
      ],
    });
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: MONDAY });

    expect(sent).toHaveLength(1);
  });

  describe("previewTaskDigestCount", () => {
    const ctxOf = (repos: Repos, sender: EmailSender) => ({
      repos,
      sender,
      appUrl: "http://localhost:3000",
    });

    it("counts speakers a manual send would actually reach", async () => {
      const { repos } = fakeRepos(baseSeed());
      const { sender } = fakeSender();

      const count = await previewTaskDigestCount(ctxOf(repos, sender), event(), NOW);

      expect(count).toBe(1);
    });

    it("agrees exactly with what runReminderJob then sends — the confirm dialog's promise", async () => {
      // The button's confirm dialog and its actual send read from the same
      // seed independently here; a real double-click risk (the send changing
      // the count between preview and click) is exactly what the manual
      // cooldown, not this test, guards against.
      const seed = baseSeed();
      const { repos: previewRepos } = fakeRepos(seed);
      const { repos: sendRepos } = fakeRepos(seed);
      const { sender, sent } = fakeSender();

      const count = await previewTaskDigestCount(ctxOf(previewRepos, sender), event(), NOW);
      const result = await runReminderJob({ repos: sendRepos, sender, now: NOW, manual: true });

      expect(count).toBe(1);
      expect(result.remindersSent).toBe(count);
      expect(sent).toHaveLength(count);
    });

    it("excludes a speaker whose checklist is already clear", async () => {
      const seed = baseSeed();
      const { repos } = fakeRepos({
        ...seed,
        assignments: seed.assignments.map((row) => ({ ...row, status: "completed" as const })),
      });
      const { sender } = fakeSender();

      expect(await previewTaskDigestCount(ctxOf(repos, sender), event(), NOW)).toBe(0);
    });

    it("excludes a speaker already inside the manual cooldown", async () => {
      const { repos } = fakeRepos({
        ...baseSeed(),
        emailLog: [digestLog(new Date(NOW.getTime() - 1 * 60 * 60 * 1000))],
      });
      const { sender } = fakeSender();

      expect(await previewTaskDigestCount(ctxOf(repos, sender), event(), NOW)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// The communication log
// ---------------------------------------------------------------------------

describe("buildCommunicationLog", () => {
  it("merges the sets and drops rows counted twice", () => {
    // A decision email is found both by recipient and by related submission;
    // it's one message and must appear once.
    const shared = logEntry({ id: "log-a", kind: "decision" });
    const merged = buildCommunicationLog([shared], [shared, logEntry({ id: "log-b" })]);

    expect(merged.map((row) => row.id)).toEqual(["log-a", "log-b"]);
  });

  it("puts the most recent message first", () => {
    const older = logEntry({ id: "old", sentAt: new Date(NOW.getTime() - 5 * DAY) });
    const newer = logEntry({ id: "new", sentAt: NOW });

    expect(buildCommunicationLog([older, newer]).map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("returns nothing for an event that has sent nothing", () => {
    expect(buildCommunicationLog([], [])).toEqual([]);
  });
});

describe("filterCommunicationLog", () => {
  const entries = [
    logEntry({ id: "a", to: "priya@example.test", kind: "decision" }),
    logEntry({ id: "b", to: "sam@example.test", kind: "task_reminder" }),
    logEntry({ id: "c", to: "priya@example.test", kind: "task_reminder" }),
  ];

  it("narrows to one speaker — spec.md §7's per-speaker log", () => {
    expect(
      filterCommunicationLog(entries, { recipient: "priya@example.test" }).map((row) => row.id),
    ).toEqual(["a", "c"]);
  });

  it("ignores the case of the address", () => {
    // Addresses arrive from forms and imports; "Priya@" and "priya@" are the
    // same mailbox and must not split someone's history in two.
    expect(
      filterCommunicationLog(entries, { recipient: "PRIYA@example.test" }).map((row) => row.id),
    ).toEqual(["a", "c"]);
  });

  it("narrows by message type", () => {
    expect(filterCommunicationLog(entries, { kind: "decision" }).map((row) => row.id)).toEqual([
      "a",
    ]);
  });

  it("applies both filters together", () => {
    expect(
      filterCommunicationLog(entries, {
        recipient: "priya@example.test",
        kind: "task_reminder",
      }).map((row) => row.id),
    ).toEqual(["c"]);
  });

  it("returns everything when nothing is asked for", () => {
    expect(filterCommunicationLog(entries, {})).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Calendar invite status
// ---------------------------------------------------------------------------

describe("summarizeSessionInvites", () => {
  it("counts only calendar invites, per session", () => {
    const summary = summarizeSessionInvites([
      logEntry({ id: "1", kind: "calendar_invite", relatedType: "session", relatedId: "s1" }),
      logEntry({ id: "2", kind: "decision", relatedType: "session", relatedId: "s1" }),
      logEntry({ id: "3", kind: "calendar_invite", relatedType: "session", relatedId: "s2" }),
    ]);

    expect(summary.get("s1")?.sentCount).toBe(1);
    expect(summary.get("s2")?.sentCount).toBe(1);
  });

  it("reports the latest send and everyone it reached", () => {
    const first = new Date(NOW.getTime() - 2 * DAY);
    const summary = summarizeSessionInvites([
      logEntry({
        id: "1",
        kind: "calendar_invite",
        relatedType: "session",
        relatedId: "s1",
        to: "priya@example.test",
        sentAt: first,
      }),
      logEntry({
        id: "2",
        kind: "calendar_invite",
        relatedType: "session",
        relatedId: "s1",
        to: "sam@example.test",
        sentAt: NOW,
      }),
    ]);

    const entry = summary.get("s1");
    expect(entry?.sentCount).toBe(2);
    expect(entry?.lastSentAt).toEqual(NOW);
    expect(entry?.recipients.sort()).toEqual(["priya@example.test", "sam@example.test"]);
  });

  it("keeps failures out of the sent count but visible", () => {
    const summary = summarizeSessionInvites([
      logEntry({
        id: "1",
        kind: "calendar_invite",
        relatedType: "session",
        relatedId: "s1",
        status: "failed",
        error: "bounced",
      }),
    ]);

    expect(summary.get("s1")?.sentCount).toBe(0);
    expect(summary.get("s1")?.failedCount).toBe(1);
  });
});

describe("inviteBlocker", () => {
  const scheduled: Pick<Session, "day" | "startTime" | "endTime" | "status"> = {
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:45",
    status: "confirmed",
  };

  it("clears a scheduled session with a speaker on it", () => {
    expect(inviteBlocker(scheduled, 1)).toBeNull();
  });

  it("blocks a session with no day or time — the .ics would have nothing to say", () => {
    expect(inviteBlocker({ ...scheduled, day: null }, 1)).toBe("unscheduled");
    expect(inviteBlocker({ ...scheduled, startTime: null }, 1)).toBe("unscheduled");
    expect(inviteBlocker({ ...scheduled, endTime: null }, 1)).toBe("unscheduled");
  });

  it("blocks a session nobody is presenting", () => {
    expect(inviteBlocker(scheduled, 0)).toBe("no_speakers");
  });

  it("blocks a cancelled session ahead of anything else", () => {
    expect(inviteBlocker({ ...scheduled, day: null, status: "cancelled" }, 0)).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// sendRoundReminders — the manual reviewer completion nudge (D-050)
// ---------------------------------------------------------------------------

describe("sendRoundReminders", () => {
  function round(overrides: Partial<ReviewRound> = {}): ReviewRound {
    return {
      id: "round-1",
      eventId: "event-1",
      name: "Initial Review",
      description: null,
      opensAt: null,
      closesAt: null,
      criteria: [],
      blindReview: false,
      ...timestamps(),
      ...overrides,
    };
  }

  function roundAssignment(overrides: Partial<RoundAssignment> & { id: string }): RoundAssignment {
    return {
      roundId: "round-1",
      submissionId: "submission-1",
      reviewerId: "reviewer-1",
      status: "pending",
      recusalReason: null,
      ...timestamps(),
      ...overrides,
    };
  }

  function roundScore(assignmentId: string): RoundScore {
    return {
      id: `score-${assignmentId}`,
      assignmentId,
      values: {},
      submittedAt: NOW,
      ...timestamps(),
    };
  }

  /** Just enough of the repository layer for `sendRoundReminders`. */
  function fakeRoundRepos(seed: {
    round: ReviewRound;
    assignments: RoundAssignment[];
    scores?: RoundScore[];
    users: User[];
    events: Event[];
  }) {
    const emails: EmailLog[] = [];
    const repos = {
      reviewRounds: {
        getById: async (id: string) => (id === seed.round.id ? seed.round : null),
        listAssignments: async (roundId: string) =>
          seed.assignments.filter((row) => row.roundId === roundId),
        listScoresByAssignments: async (assignmentIds: string[]) =>
          (seed.scores ?? []).filter((row) => assignmentIds.includes(row.assignmentId)),
      },
      events: {
        getById: async (id: string) => seed.events.find((row) => row.id === id) ?? null,
      },
      users: {
        listByIds: async (ids: string[]) => seed.users.filter((row) => ids.includes(row.id)),
      },
      emailTemplates: {
        listByEvent: async () => [],
      },
      emailLog: {
        create: async (row: NewEmailLog) => {
          const created: EmailLog = { id: `log-${emails.length + 1}`, ...row };
          emails.push(created);
          return created;
        },
      },
    };
    return { repos: repos as unknown as Repos, emails };
  }

  function context(repos: Repos, sender: EmailSender): CommsContext {
    return { repos, sender, appUrl: "https://example.com", now: NOW };
  }

  it("emails every reviewer with unfiled scorecards, and nobody else", async () => {
    const dana = user({ id: "dana", email: "dana@example.test", name: "Dana Scully" });
    const marco = user({ id: "marco", email: "marco@example.test", name: "Marco Polo" });
    const { repos } = fakeRoundRepos({
      round: round(),
      assignments: [
        roundAssignment({ id: "a1", reviewerId: "dana" }),
        roundAssignment({ id: "a2", reviewerId: "dana" }),
        roundAssignment({ id: "a3", reviewerId: "marco" }),
      ],
      // Dana has filed one of her two; Marco has filed everything.
      scores: [roundScore("a1"), roundScore("a3")],
      users: [dana, marco],
      events: [event()],
    });
    const { sender, sent } = fakeSender();

    const deliveries = await sendRoundReminders(context(repos, sender), { roundId: "round-1" });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].to).toBe("dana@example.test");
    expect(deliveries[0].status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("dana@example.test");
    expect(sent[0].subject).toBe("Reminder: 1 scorecard waiting in Initial Review");
    expect(sent[0].text).toContain("Initial Review");
    expect(sent[0].text).toContain("1 scorecard");
    expect(sent[0].text).toContain(
      "https://example.com/admin/aie-2026/rounds/round-1/score",
    );
  });

  it("sends nothing, and touches no repo write, when every scorecard is filed", async () => {
    const dana = user({ id: "dana", email: "dana@example.test" });
    const { repos, emails } = fakeRoundRepos({
      round: round(),
      assignments: [roundAssignment({ id: "a1", reviewerId: "dana" })],
      scores: [roundScore("a1")],
      users: [dana],
      events: [event()],
    });
    const { sender, sent } = fakeSender();

    const deliveries = await sendRoundReminders(context(repos, sender), { roundId: "round-1" });

    expect(deliveries).toEqual([]);
    expect(sent).toEqual([]);
    expect(emails).toEqual([]);
  });

  it("never counts a recusal as pending", async () => {
    const dana = user({ id: "dana", email: "dana@example.test" });
    const { repos } = fakeRoundRepos({
      round: round(),
      assignments: [roundAssignment({ id: "a1", reviewerId: "dana", status: "recused" })],
      users: [dana],
      events: [event()],
    });
    const { sender, sent } = fakeSender();

    const deliveries = await sendRoundReminders(context(repos, sender), { roundId: "round-1" });

    expect(deliveries).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("throws for an unknown round rather than silently sending nothing", async () => {
    const { repos } = fakeRoundRepos({ round: round(), assignments: [], users: [], events: [event()] });
    const { sender } = fakeSender();

    await expect(
      sendRoundReminders(context(repos, sender), { roundId: "no-such-round" }),
    ).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// sendTeamInvite — the Team page's "Add a teammate" send (D-062)
// ---------------------------------------------------------------------------

describe("sendTeamInvite", () => {
  function fakeInviteRepos() {
    const emails: EmailLog[] = [];
    const repos = {
      emailLog: {
        create: async (row: NewEmailLog) => {
          const created: EmailLog = { id: `log-${emails.length + 1}`, ...row };
          emails.push(created);
          return created;
        },
      },
    };
    return { repos: repos as unknown as Repos, emails };
  }

  function context(repos: Repos, sender: EmailSender): CommsContext {
    return { repos, sender, appUrl: "https://example.com", now: NOW };
  }

  it("emails the invited address with the inviter, event, role and sign-in link", async () => {
    const { repos, emails } = fakeInviteRepos();
    const { sender, sent } = fakeSender();

    const delivery = await sendTeamInvite(context(repos, sender), {
      userId: "user-1",
      email: "dana@example.test",
      roleLabel: "Reviewer",
      eventName: "AIE 2026",
      inviterName: "Priya Raman",
    });

    expect(delivery.status).toBe("sent");
    expect(delivery.to).toBe("dana@example.test");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Priya Raman invited you to join AIE 2026 on Greenroom");
    expect(sent[0].text).toContain("Priya Raman added you to the AIE 2026 team");
    expect(sent[0].text).toContain("as a reviewer");
    expect(sent[0].text).toContain("https://example.com/login");

    // Logged like every other send, and tied to the invited user's id.
    expect(emails).toHaveLength(1);
    expect(emails[0].kind).toBe("team_invite");
    expect(emails[0].relatedType).toBe("user");
    expect(emails[0].relatedId).toBe("user-1");
  });

  it("gives an admin role its own article", async () => {
    const { repos } = fakeInviteRepos();
    const { sender, sent } = fakeSender();

    await sendTeamInvite(context(repos, sender), {
      userId: "user-2",
      email: "marco@example.test",
      roleLabel: "Admin",
      eventName: "AIE 2026",
      inviterName: "Priya Raman",
    });

    expect(sent[0].text).toContain("as an admin");
  });
});
