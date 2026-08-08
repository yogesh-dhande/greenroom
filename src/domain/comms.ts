/**
 * Comms domain service — every speaker-facing email the product sends
 * (spec.md §7: real delivery, working calendar invites, templated messages
 * with merge fields, a communication log per speaker; decisions.md D-017 says
 * none of this may be a stub).
 *
 * Pure TypeScript: no datastore imports. Everything arrives through
 * dependency injection — the storage-agnostic `Repos` bundle
 * (src/db/repos/index.ts) and an `EmailSender` (src/lib/email.ts), both plain
 * interfaces. Route handlers, server actions and the cron worker construct
 * those and call in here.
 *
 * Each `send*` function follows the same shape: read what it needs through
 * the repos, assemble merge data, render the template
 * (src/domain/comms-templates.ts), send, and record the attempt in
 * `email_log`. Sends are per-recipient and independent: one bad address never
 * stops the rest, and every outcome comes back in the result array.
 */
import type {
  EmailTemplate,
  Event,
  Room,
  Session,
  Submission,
  SubmissionDecision,
  Task,
  TaskAssignment,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  createLoggingEmailSender,
  type EmailLogContext,
  type EmailSender,
  type SentEmail,
} from "@/lib/email";
import {
  formatDayRange,
  formatDeadline,
  formatEventWhen,
  formatShortDate,
  formatZoneAbbreviation,
  wallClockDurationMinutes,
  zonedWallClockToInstant,
} from "@/lib/event-time";
import { buildCalendarInvite, calendarUidForSession, type CalendarMethod } from "@/lib/ics";
import {
  type CommsTemplateId,
  type MergeData,
  type RenderedEmail,
  renderCommsTemplate,
  renderMessage,
} from "@/domain/comms-templates";

export * from "@/domain/comms-templates";

// ---------------------------------------------------------------------------
// Context & results
// ---------------------------------------------------------------------------

export interface CommsContext {
  repos: Repos;
  /**
   * The **raw** transport (src/lib/email.ts `getEmailSender`). This module
   * wraps it in the `email_log` decorator itself, so passing an
   * already-wrapped sender would double-log.
   */
  sender: EmailSender;
  /** Absolute origin for portal/event links, no trailing slash. */
  appUrl: string;
  /** Signature line on outgoing mail; the From identity stays separate. */
  organizerName?: string;
  /** Domain used in calendar UIDs; only affects uniqueness, not delivery. */
  uidDomain?: string;
  /** Defaults to now; overridable for tests and fixtures. */
  now?: Date;
}

export interface CommsDelivery {
  to: string;
  subject: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
  /** Dev transport only: files written for inspection. */
  files?: string[];
}

export interface CalendarDelivery extends CommsDelivery {
  uid: string;
  sequence: number;
  /** The exact iCalendar object that was attached. */
  ics: string;
}

const DEFAULT_ORGANIZER_NAME = "The program team";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function portalUrl(ctx: CommsContext): string {
  return `${trimTrailingSlash(ctx.appUrl)}/portal`;
}

function eventUrl(ctx: CommsContext, event: Event): string {
  return `${trimTrailingSlash(ctx.appUrl)}/e/${event.slug}`;
}

function nowOf(ctx: CommsContext): Date {
  return ctx.now ?? new Date();
}

/** Shared send path: render + deliver + write the `email_log` row. */
async function deliver(
  ctx: CommsContext,
  to: string,
  message: RenderedEmail,
  log: EmailLogContext,
  extras: { calendar?: Parameters<EmailSender["send"]>[0]["calendar"] } = {},
): Promise<CommsDelivery> {
  const sender = createLoggingEmailSender(ctx.sender, ctx.repos.emailLog);
  try {
    const sent: SentEmail = await sender.send({
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: ctx.sender.from.email,
      calendar: extras.calendar,
      log,
    });
    return { to, subject: message.subject, status: "sent", messageId: sent.id, files: sent.files };
  } catch (error) {
    return {
      to,
      subject: message.subject,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Merge-data assembly
// ---------------------------------------------------------------------------

function firstName(user: User): string {
  const name = user.name?.trim();
  if (!name) return "there";
  return name.split(/\s+/)[0];
}

function displayName(user: User): string {
  return user.name?.trim() || user.email;
}

/** Event-level fields, present on every message. */
function eventFields(ctx: CommsContext, event: Event): MergeData {
  const reference = event.startDate
    ? zonedWallClockToInstant(event.startDate, "12:00", event.timezone)
    : nowOf(ctx);
  return {
    eventName: event.name,
    eventDates: formatDayRange(event.startDate, event.endDate, event.timezone),
    eventLocation: event.location ?? "",
    eventTimezone: formatZoneAbbreviation(reference, event.timezone),
    eventUrl: eventUrl(ctx, event),
    organizerName: ctx.organizerName ?? DEFAULT_ORGANIZER_NAME,
    organizerEmail: ctx.sender.from.email,
    portalUrl: portalUrl(ctx),
  };
}

function speakerFields(user: User): MergeData {
  return { speakerName: displayName(user), speakerFirstName: firstName(user) };
}

function sessionFields(session: Session, event: Event, room: Room | null): MergeData {
  const scheduled = session.day && session.startTime && session.endTime;
  return {
    sessionTitle: session.title,
    sessionWhen: scheduled
      ? formatEventWhen(session.day!, session.startTime!, session.endTime!, event.timezone)
      : "",
    sessionRoom: room?.name ?? "",
    sessionDuration: scheduled
      ? `${wallClockDurationMinutes(session.startTime!, session.endTime!)} minutes`
      : "",
  };
}

function taskFields(task: Task, event: Event): MergeData {
  return {
    taskTitle: task.title,
    taskInstructions: task.instructions ?? "",
    taskDueDate: task.dueAt ? formatDeadline(task.dueAt, event.timezone) : "",
  };
}

/** "- Upload your headshot (due June 5)" per outstanding item, or "". */
async function outstandingTasksFor(
  ctx: CommsContext,
  event: Event,
  speakerId: string,
  excludeTaskId?: string,
): Promise<string> {
  const [assignments, tasks] = await Promise.all([
    ctx.repos.taskAssignments.listBySpeaker(speakerId),
    ctx.repos.tasks.listByEvent(event.id),
  ]);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  const lines = assignments
    .filter((assignment) => assignment.status !== "completed")
    .map((assignment) => tasksById.get(assignment.taskId))
    .filter((task): task is Task => Boolean(task) && task!.id !== excludeTaskId)
    .map((task) =>
      task.dueAt
        ? `- ${task.title} (due ${formatShortDate(task.dueAt, event.timezone)})`
        : `- ${task.title}`,
    );
  return lines.join("\n");
}

async function requireEvent(ctx: CommsContext, eventId: string): Promise<Event> {
  const event = await ctx.repos.events.getById(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  return event;
}

async function requireUsers(ctx: CommsContext, userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) return [];
  const users = await ctx.repos.users.listByIds(userIds);
  // Preserve caller order (primary speaker first) — listByIds may not.
  const byId = new Map(users.map((user) => [user.id, user]));
  return userIds.map((id) => byId.get(id)).filter((user): user is User => Boolean(user));
}

/** Speakers on a submission, primary first. */
async function submissionSpeakers(ctx: CommsContext, submissionId: string): Promise<User[]> {
  const links = await ctx.repos.submissions.listSpeakers(submissionId);
  const ordered = [...links].sort((a, b) => (a.role === "primary" ? -1 : b.role === "primary" ? 1 : 0));
  return requireUsers(ctx, ordered.map((link) => link.userId));
}

// ---------------------------------------------------------------------------
// Submission confirmation (spec.md §2 — an explicit must-have)
// ---------------------------------------------------------------------------

export interface SubmissionConfirmationInput {
  submissionId: string;
  /** Send to co-speakers too. Default: submitter only. */
  includeCoSpeakers?: boolean;
}

/**
 * Confirms a proposal was received. If the form carries its own confirmation
 * copy (`forms.confirmationEmailSubject`/`Body`, editable per CFP form) that
 * copy is used; otherwise the built-in template is.
 */
export async function sendSubmissionConfirmation(
  ctx: CommsContext,
  input: SubmissionConfirmationInput,
): Promise<CommsDelivery[]> {
  const submission = await ctx.repos.submissions.getById(input.submissionId);
  if (!submission) throw new Error(`Submission ${input.submissionId} not found`);

  const [event, form, speakers] = await Promise.all([
    requireEvent(ctx, submission.eventId),
    ctx.repos.forms.getById(submission.formId),
    submissionSpeakers(ctx, submission.id),
  ]);
  const recipients = input.includeCoSpeakers ? speakers : speakers.slice(0, 1);

  const custom =
    form?.confirmationEmailSubject && form.confirmationEmailBody
      ? { subject: form.confirmationEmailSubject, body: form.confirmationEmailBody }
      : null;

  const results: CommsDelivery[] = [];
  for (const user of recipients) {
    const data: MergeData = {
      ...eventFields(ctx, event),
      ...speakerFields(user),
      submissionTitle: submission.title,
      changeDueDate: form?.closesAt ? formatDeadline(form.closesAt, event.timezone) : "",
    };
    const message = custom
      ? renderMessage(custom, data)
      : renderCommsTemplate("submission_confirmation", data);
    results.push(
      await deliver(ctx, user.email, message, {
        kind: "submission_confirmation",
        relatedType: "submission",
        relatedId: submission.id,
      }),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Decisions (spec.md §4, §5)
// ---------------------------------------------------------------------------

const DECISION_TEMPLATES: Record<SubmissionDecision, CommsTemplateId> = {
  approved: "submission_accepted",
  maybe: "submission_waitlisted",
  denied: "submission_declined",
};

export interface DecisionEmailInput {
  submissionId: string;
  /** Defaults to the submission's recorded status. */
  decision?: SubmissionDecision;
  /** Feedback for the speaker; defaults to `submissions.decisionNote`. */
  note?: string | null;
}

function decisionOf(submission: Submission, override?: SubmissionDecision): SubmissionDecision {
  if (override) return override;
  if (submission.status === "approved" || submission.status === "maybe" || submission.status === "denied") {
    return submission.status;
  }
  throw new Error(
    `Submission ${submission.id} has status "${submission.status}" — no decision to communicate`,
  );
}

/** Accept / waitlist / decline notice, sent to every speaker on the talk. */
export async function sendDecisionEmail(
  ctx: CommsContext,
  input: DecisionEmailInput,
): Promise<CommsDelivery[]> {
  const submission = await ctx.repos.submissions.getById(input.submissionId);
  if (!submission) throw new Error(`Submission ${input.submissionId} not found`);

  const decision = decisionOf(submission, input.decision);
  const [event, speakers, session] = await Promise.all([
    requireEvent(ctx, submission.eventId),
    submissionSpeakers(ctx, submission.id),
    ctx.repos.sessions.getBySubmission(submission.id),
  ]);
  const room = session?.roomId ? await ctx.repos.rooms.getById(session.roomId) : null;

  const results: CommsDelivery[] = [];
  for (const user of speakers) {
    const data: MergeData = {
      ...eventFields(ctx, event),
      ...speakerFields(user),
      ...(session ? sessionFields(session, event, room) : {}),
      submissionTitle: submission.title,
      decisionNote: (input.note ?? submission.decisionNote) || "",
      outstandingTasks:
        decision === "approved" ? await outstandingTasksFor(ctx, event, user.id) : "",
    };
    const message = renderCommsTemplate(DECISION_TEMPLATES[decision], data);
    results.push(
      await deliver(ctx, user.email, message, {
        kind: "decision",
        relatedType: "submission",
        relatedId: submission.id,
      }),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Change / missing-information request (spec.md §7)
// ---------------------------------------------------------------------------

export interface ChangeRequestInput {
  submissionId: string;
  /** What the speaker needs to change or supply, in the organizer's words. */
  request: string;
  /** Optional deadline for the change. */
  dueAt?: Date | null;
  includeCoSpeakers?: boolean;
}

export async function sendChangeRequest(
  ctx: CommsContext,
  input: ChangeRequestInput,
): Promise<CommsDelivery[]> {
  const submission = await ctx.repos.submissions.getById(input.submissionId);
  if (!submission) throw new Error(`Submission ${input.submissionId} not found`);

  const [event, speakers] = await Promise.all([
    requireEvent(ctx, submission.eventId),
    submissionSpeakers(ctx, submission.id),
  ]);
  const recipients = input.includeCoSpeakers ? speakers : speakers.slice(0, 1);

  const results: CommsDelivery[] = [];
  for (const user of recipients) {
    const data: MergeData = {
      ...eventFields(ctx, event),
      ...speakerFields(user),
      submissionTitle: submission.title,
      changeRequest: input.request,
      changeDueDate: input.dueAt ? formatDeadline(input.dueAt, event.timezone) : "",
    };
    results.push(
      await deliver(ctx, user.email, renderCommsTemplate("change_request", data), {
        // `email_log.kind` has no dedicated change-request value; "manual"
        // is the closest fit in the shipped schema.
        kind: "manual",
        relatedType: "submission",
        relatedId: submission.id,
      }),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Task / deadline reminders (spec.md §6, decisions.md D-013)
// ---------------------------------------------------------------------------

export interface TaskReminderInput {
  assignmentId: string;
}

export async function sendTaskReminder(
  ctx: CommsContext,
  input: TaskReminderInput,
): Promise<CommsDelivery[]> {
  const assignment = await ctx.repos.taskAssignments.getById(input.assignmentId);
  if (!assignment) throw new Error(`Task assignment ${input.assignmentId} not found`);

  const task = await ctx.repos.tasks.getById(assignment.taskId);
  if (!task) throw new Error(`Task ${assignment.taskId} not found`);

  const [event, user] = await Promise.all([
    requireEvent(ctx, task.eventId),
    ctx.repos.users.getById(assignment.speakerId),
  ]);
  if (!user) throw new Error(`Speaker ${assignment.speakerId} not found`);

  const data: MergeData = {
    ...eventFields(ctx, event),
    ...speakerFields(user),
    ...taskFields(task, event),
    outstandingTasks: await outstandingTasksFor(ctx, event, user.id, task.id),
  };
  return [
    await deliver(ctx, user.email, renderCommsTemplate("task_reminder", data), {
      kind: "task_reminder",
      relatedType: "task_assignment",
      relatedId: assignment.id,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Calendar invites (spec.md §7, decisions.md D-003)
// ---------------------------------------------------------------------------

export interface CalendarInviteInput {
  sessionId: string;
  /** `CANCEL` withdraws the entry from the speaker's calendar. */
  method?: CalendarMethod;
  /**
   * Overrides the derived SEQUENCE. Leave unset in production — see
   * `nextSequenceFor` for how it's derived from `email_log`.
   */
  sequence?: number;
}

/**
 * The SEQUENCE for the next invite to `email`, derived from how many invites
 * for this session that address has already received.
 *
 * The shipped schema has nowhere to persist a per-session sequence counter
 * (neither `sessions` nor `email_log` has such a column), so it is derived
 * rather than stored. Counting per recipient is what actually matters: a
 * calendar applies an update when the incoming SEQUENCE is higher than the
 * one *it* holds, and each attendee's calendar only ever sees the stream of
 * invites addressed to them. Speakers invited in the same batch therefore
 * stay in lockstep; a speaker added to a session later simply starts at 0 on
 * their own timeline, which is correct for them.
 */
async function nextSequenceFor(
  ctx: CommsContext,
  sessionId: string,
  email: string,
): Promise<number> {
  return ctx.repos.emailLog.count({
    to: email,
    kind: "calendar_invite",
    relatedType: "session",
    relatedId: sessionId,
    status: "sent",
  });
}

/**
 * Sends (or re-sends) the calendar invitation for a session to every speaker
 * on it, as an RFC 6047 iMIP `METHOD:REQUEST` part.
 *
 * Re-sending after a room assignment or a time change produces the same UID
 * with a higher SEQUENCE, so the speaker's existing calendar entry is
 * updated in place rather than duplicated — the behaviour spec.md §7 asks
 * for ("support sending initially without a room and updating the invite
 * after room assignment").
 */
export async function sendCalendarInvite(
  ctx: CommsContext,
  input: CalendarInviteInput,
): Promise<CalendarDelivery[]> {
  const session = await ctx.repos.sessions.getById(input.sessionId);
  if (!session) throw new Error(`Session ${input.sessionId} not found`);
  if (!session.day || !session.startTime || !session.endTime) {
    throw new Error(
      `Session ${session.id} ("${session.title}") has no day/time yet — schedule it before inviting speakers`,
    );
  }

  const [event, speakerIds] = await Promise.all([
    requireEvent(ctx, session.eventId),
    ctx.repos.sessions.listSpeakerIds(session.id),
  ]);
  const [speakers, room] = await Promise.all([
    requireUsers(ctx, speakerIds),
    session.roomId ? ctx.repos.rooms.getById(session.roomId) : Promise.resolve(null),
  ]);
  if (speakers.length === 0) {
    throw new Error(`Session ${session.id} has no speakers to invite`);
  }

  const method = input.method ?? "REQUEST";
  const location = [room?.name, event.location].filter(Boolean).join(", ") || null;
  const organizer = { name: event.name, email: ctx.sender.from.email };
  // Every speaker on the session appears on every copy, so each of them sees
  // who else is on stage; the organizer is CHAIR and already accepted.
  const attendees = [
    ...speakers.map((user) => ({ name: displayName(user), email: user.email })),
    { name: event.name, email: organizer.email, role: "CHAIR" as const, partstat: "ACCEPTED" as const, rsvp: false },
  ];

  const results: CalendarDelivery[] = [];
  for (const user of speakers) {
    const sequence = input.sequence ?? (await nextSequenceFor(ctx, session.id, user.email));
    const invite = buildCalendarInvite({
      uid: calendarUidForSession(session.id, ctx.uidDomain),
      sequence,
      method,
      title: session.title,
      description: session.description,
      location,
      url: eventUrl(ctx, event),
      timeZone: event.timezone,
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
      organizer,
      attendees,
      status: method === "CANCEL" ? "CANCELLED" : "CONFIRMED",
      stamp: ctx.now,
    });

    const data: MergeData = {
      ...eventFields(ctx, event),
      ...speakerFields(user),
      ...sessionFields(session, event, room),
    };
    const delivery = await deliver(
      ctx,
      user.email,
      renderCommsTemplate("calendar_invite", data),
      { kind: "calendar_invite", relatedType: "session", relatedId: session.id },
      {
        calendar: {
          method: invite.method,
          filename: invite.filename,
          content: invite.content,
          contentType: invite.contentType,
        },
      },
    );
    results.push({ ...delivery, uid: invite.uid, sequence, ics: invite.content });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Ad-hoc / organizer-authored templates
// ---------------------------------------------------------------------------

export interface ManualEmailInput {
  /** A row from `email_templates`, or any `{subject, body}` pair. */
  template: Pick<EmailTemplate, "subject" | "body">;
  to: string;
  data: MergeData;
  log?: EmailLogContext;
}

/** Sends an organizer-authored templated message (the admin Communications
 * screen's "send to speaker" path). */
export async function sendManualEmail(
  ctx: CommsContext,
  input: ManualEmailInput,
): Promise<CommsDelivery> {
  return deliver(
    ctx,
    input.to,
    renderMessage(input.template, input.data),
    input.log ?? { kind: "manual" },
  );
}

// ---------------------------------------------------------------------------
// The reminder cron (decisions.md D-013)
// ---------------------------------------------------------------------------

export interface ReminderCandidate {
  assignment: TaskAssignment;
  task: Task;
  user: User;
  event: Event;
}

export interface RunReminderJobInput extends Omit<CommsContext, "appUrl"> {
  appUrl?: string;
  /** Remind about anything due within this many days. Default 7. */
  lookaheadDays?: number;
  /** Don't re-remind about the same assignment inside this window. Default 3 days. */
  cooldownDays?: number;
}

export interface RunReminderJobResult {
  remindersSent: number;
  remindersFailed: number;
  /** Skipped because a reminder went out inside the cooldown window. */
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cron-triggered deadline reminders, wired up in custom-worker.ts's
 * `scheduled` handler (every 15 minutes per wrangler.jsonc).
 *
 * Idempotency comes from `email_log` rather than a "reminded" flag: an
 * assignment is skipped when a `task_reminder` for it was recorded inside the
 * cooldown window, so re-running the job — or running it on overlapping
 * schedules — never double-sends.
 */
export async function runReminderJob(
  input: RunReminderJobInput,
): Promise<RunReminderJobResult> {
  const ctx: CommsContext = { ...input, appUrl: input.appUrl ?? "http://localhost:3000" };
  const now = nowOf(ctx);
  const horizon = new Date(now.getTime() + (input.lookaheadDays ?? 7) * DAY_MS);
  const cooldownStart = new Date(now.getTime() - (input.cooldownDays ?? 3) * DAY_MS);

  const result: RunReminderJobResult = { remindersSent: 0, remindersFailed: 0, skipped: 0 };

  for (const event of await ctx.repos.events.listAll()) {
    const assignments = await ctx.repos.taskAssignments.listPendingDueBefore(event.id, horizon);
    for (const assignment of assignments) {
      const recentlyReminded = await ctx.repos.emailLog.count({
        kind: "task_reminder",
        relatedType: "task_assignment",
        relatedId: assignment.id,
        status: "sent",
        sentSince: cooldownStart,
      });
      if (recentlyReminded > 0) {
        result.skipped += 1;
        continue;
      }
      const [delivery] = await sendTaskReminder(ctx, { assignmentId: assignment.id });
      if (delivery?.status === "sent") result.remindersSent += 1;
      else result.remindersFailed += 1;
    }
  }
  return result;
}
