import { describe, expect, it } from "vitest";
import type {
  EmailLog,
  Event,
  NewEmailLog,
  Session,
  Task,
  TaskAssignment,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import type { EmailSender } from "@/lib/email";
import {
  buildCommunicationLog,
  decideReminder,
  DEFAULT_REMINDER_COOLDOWN_DAYS,
  filterCommunicationLog,
  inviteBlocker,
  runReminderJob,
  summarizeSessionInvites,
  type ReminderDecisionInput,
} from "@/domain/comms";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-01T17:00:00.000Z");

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
    kind: "task_reminder",
    relatedType: "task_assignment",
    relatedId: "assignment-1",
    status: "sent",
    error: null,
    sentAt: NOW,
    ...overrides,
  };
}

function reminderInput(overrides: Partial<ReminderDecisionInput> = {}): ReminderDecisionInput {
  return {
    status: "pending",
    dueAt: new Date(NOW.getTime() + 2 * DAY),
    lastRemindedAt: null,
    eventStartDate: "2026-06-16",
    timezone: "America/Los_Angeles",
    now: NOW,
    cooldownDays: DEFAULT_REMINDER_COOLDOWN_DAYS,
    lookaheadDays: 7,
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
}) {
  const emails: EmailLog[] = [...(seed.emailLog ?? [])];

  const repos = {
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
  const sent: Array<{ to: string; subject: string }> = [];
  const sender: EmailSender = {
    from: { name: "Greenroom", email: "hello@greenroom.test" },
    async send(message) {
      sent.push({ to: message.to, subject: message.subject });
      return { id: `msg-${sent.length}` };
    },
  };
  return { sender, sent };
}

// ---------------------------------------------------------------------------
// decideReminder — questions.md Q4's cadence
// ---------------------------------------------------------------------------

describe("decideReminder", () => {
  it("sends for a pending task due inside the lookahead window", () => {
    expect(decideReminder(reminderInput())).toEqual({ send: true });
  });

  it("never nags about a task that's done", () => {
    expect(decideReminder(reminderInput({ status: "completed" }))).toEqual({
      send: false,
      reason: "completed",
    });
  });

  it("stops once the event has started", () => {
    // The event begins on 2026-06-16 in Los Angeles; "now" is the day after.
    expect(
      decideReminder(reminderInput({ now: new Date("2026-06-17T12:00:00.000Z") })),
    ).toEqual({ send: false, reason: "event_started" });
  });

  it("treats the event's start as midnight in the event's own timezone", () => {
    // 2026-06-16T05:00Z is 10pm on the 15th in Los Angeles — still before the
    // event begins, even though UTC has already ticked over to the 16th.
    expect(
      decideReminder(reminderInput({ now: new Date("2026-06-16T05:00:00.000Z") })).send,
    ).toBe(true);
    expect(
      decideReminder(reminderInput({ now: new Date("2026-06-16T08:00:00.000Z") })),
    ).toEqual({ send: false, reason: "event_started" });
  });

  it("still sends for an event with no start date on the calendar", () => {
    expect(decideReminder(reminderInput({ eventStartDate: null })).send).toBe(true);
  });

  it("stays quiet about a task with no deadline", () => {
    expect(decideReminder(reminderInput({ dueAt: null }))).toEqual({
      send: false,
      reason: "not_due",
    });
  });

  it("stays quiet about a deadline beyond the lookahead window", () => {
    expect(
      decideReminder(reminderInput({ dueAt: new Date(NOW.getTime() + 30 * DAY) })),
    ).toEqual({ send: false, reason: "not_due" });
  });

  it("still chases an overdue task", () => {
    expect(decideReminder(reminderInput({ dueAt: new Date(NOW.getTime() - 5 * DAY) })).send).toBe(
      true,
    );
  });

  it("holds off for three days after the last reminder", () => {
    expect(
      decideReminder(reminderInput({ lastRemindedAt: new Date(NOW.getTime() - 1 * DAY) })),
    ).toEqual({ send: false, reason: "cooldown" });
    expect(
      decideReminder(reminderInput({ lastRemindedAt: new Date(NOW.getTime() - 2.9 * DAY) })),
    ).toEqual({ send: false, reason: "cooldown" });
  });

  it("sends again once the cooldown has elapsed", () => {
    expect(
      decideReminder(reminderInput({ lastRemindedAt: new Date(NOW.getTime() - 3 * DAY) })).send,
    ).toBe(true);
  });

  it("reports 'done' ahead of every other reason", () => {
    // A completed task inside its cooldown after the event started is still
    // reported as done — that's the reason an organizer would want to read.
    expect(
      decideReminder(
        reminderInput({
          status: "completed",
          now: new Date("2026-06-20T12:00:00.000Z"),
          lastRemindedAt: NOW,
        }),
      ),
    ).toEqual({ send: false, reason: "completed" });
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

  it("emails the pending task and skips the finished one", async () => {
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW });

    expect(result.remindersSent).toBe(1);
    expect(result.remindersFailed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedByReason.completed).toBe(1);
    expect(result.sentTo).toEqual(["priya@example.test"]);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing on an immediate second run", async () => {
    // The cooldown is what makes the cron safe to run every 15 minutes, and
    // what makes the admin's "Send reminders now" button harmless to press
    // twice: the first run's own `email_log` row suppresses the second.
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: NOW });
    const second = await runReminderJob({ repos, sender, now: NOW });

    expect(second.remindersSent).toBe(0);
    expect(second.skippedByReason.cooldown).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("holds off while yesterday's reminder is still fresh", async () => {
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [logEntry({ sentAt: new Date(NOW.getTime() - 1 * DAY) })],
    });
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW });

    expect(sent).toHaveLength(0);
    expect(result.skippedByReason.cooldown).toBe(1);
  });

  it("sends again once three days have passed", async () => {
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [logEntry({ sentAt: new Date(NOW.getTime() - 3 * DAY) })],
    });
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: NOW });

    expect(sent).toHaveLength(1);
  });

  it("goes quiet altogether once the event has started", async () => {
    const { repos } = fakeRepos(baseSeed());
    const { sender, sent } = fakeSender();

    const result = await runReminderJob({
      repos,
      sender,
      now: new Date("2026-06-17T12:00:00.000Z"),
    });

    expect(sent).toHaveLength(0);
    expect(result.skippedByReason.event_started).toBe(1);
    expect(result.skippedByReason.completed).toBe(1);
  });

  it("only touches the named event when one is given", async () => {
    const seed = baseSeed();
    const { repos } = fakeRepos({
      ...seed,
      events: [seed.events[0], event({ id: "event-2", slug: "other", name: "Other" })],
    });
    const { sender } = fakeSender();

    const result = await runReminderJob({ repos, sender, now: NOW, eventId: "event-2" });

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

    const result = await runReminderJob({ repos, sender, now: NOW });

    expect(result.remindersSent).toBe(0);
    expect(result.remindersFailed).toBe(1);
    expect(result.sentTo).toEqual([]);
  });

  it("retries after a failure rather than treating it as a reminder sent", async () => {
    // The cooldown keys off successful sends only, so a bounced attempt
    // doesn't buy the task three days of silence.
    const { repos } = fakeRepos({
      ...baseSeed(),
      emailLog: [logEntry({ status: "failed", error: "transport is down" })],
    });
    const { sender, sent } = fakeSender();

    await runReminderJob({ repos, sender, now: NOW });

    expect(sent).toHaveLength(1);
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
