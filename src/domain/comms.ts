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
  EmailKind,
  EmailLog,
  EmailTemplate,
  Event,
  Room,
  Session,
  Submission,
  SubmissionDecision,
  Task,
  TaskAssignmentStatus,
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
  type TemplateOverrideRow,
  renderMessage,
  resolveCommsTemplate,
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
// Template resolution
// ---------------------------------------------------------------------------

/**
 * The event's per-template overrides, written by the admin Communications
 * screen's template editor. Loaded once per send call and passed down, so a
 * message to eight co-speakers is still one read.
 */
async function eventTemplateOverrides(
  ctx: CommsContext,
  eventId: string,
): Promise<TemplateOverrideRow[]> {
  try {
    return await ctx.repos.emailTemplates.listByEvent(eventId);
  } catch (error) {
    // Overridden copy is a nicety; failing to read it must never stop a
    // decision or a reminder from going out.
    console.warn(`Could not read email templates for event ${eventId}:`, error);
    return [];
  }
}

/** Renders `id` using the event's override when it has one, else the built-in. */
function renderForEvent(
  id: CommsTemplateId,
  overrides: TemplateOverrideRow[],
  data: MergeData,
): RenderedEmail {
  return renderMessage(resolveCommsTemplate(id, overrides), data);
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

  const event = await requireEvent(ctx, submission.eventId);
  const [form, speakers, overrides] = await Promise.all([
    ctx.repos.forms.getById(submission.formId),
    submissionSpeakers(ctx, submission.id),
    eventTemplateOverrides(ctx, event.id),
  ]);
  const recipients = input.includeCoSpeakers ? speakers : speakers.slice(0, 1);

  // Precedence, most specific first: this form's own confirmation copy, the
  // event's override of the built-in template, then the built-in itself.
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
      : renderForEvent("submission_confirmation", overrides, data);
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
  const event = await requireEvent(ctx, submission.eventId);
  const [speakers, session, overrides] = await Promise.all([
    submissionSpeakers(ctx, submission.id),
    ctx.repos.sessions.getBySubmission(submission.id),
    eventTemplateOverrides(ctx, event.id),
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
    const message = renderForEvent(DECISION_TEMPLATES[decision], overrides, data);
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

  const event = await requireEvent(ctx, submission.eventId);
  const [speakers, overrides] = await Promise.all([
    submissionSpeakers(ctx, submission.id),
    eventTemplateOverrides(ctx, event.id),
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
      await deliver(ctx, user.email, renderForEvent("change_request", overrides, data), {
        kind: "change_request",
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

  const event = await requireEvent(ctx, task.eventId);
  const [user, overrides] = await Promise.all([
    ctx.repos.users.getById(assignment.speakerId),
    eventTemplateOverrides(ctx, event.id),
  ]);
  if (!user) throw new Error(`Speaker ${assignment.speakerId} not found`);

  const data: MergeData = {
    ...eventFields(ctx, event),
    ...speakerFields(user),
    ...taskFields(task, event),
    outstandingTasks: await outstandingTasksFor(ctx, event, user.id, task.id),
  };
  return [
    await deliver(ctx, user.email, renderForEvent("task_reminder", overrides, data), {
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
  const [speakers, room, overrides] = await Promise.all([
    requireUsers(ctx, speakerIds),
    session.roomId ? ctx.repos.rooms.getById(session.roomId) : Promise.resolve(null),
    eventTemplateOverrides(ctx, event.id),
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
      renderForEvent("calendar_invite", overrides, data),
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

/**
 * The merge data a one-off message to `user` about `event` can use —
 * `MANUAL_MERGE_FIELDS` in src/domain/comms-templates.ts is this set, and the
 * composer validates drafts against it.
 *
 * There is deliberately no submission/session context: the composer picks
 * people, not proposals, so a `{{sessionTitle}}` in a manual message would be
 * a promise the send path can't keep.
 */
export async function speakerMergeData(
  ctx: CommsContext,
  event: Event,
  user: User,
): Promise<MergeData> {
  return {
    ...eventFields(ctx, event),
    ...speakerFields(user),
    outstandingTasks: await outstandingTasksFor(ctx, event, user.id),
  };
}

// ---------------------------------------------------------------------------
// The communication log (spec.md §7 — "communication log per speaker")
// ---------------------------------------------------------------------------

/**
 * Merges the log reads that make up one event's correspondence into a single
 * newest-first history, with duplicates removed.
 *
 * Two reads are needed and they overlap. `email_log` rows are addressed to a
 * person, not to an event, so an event's mail is "everything sent to one of
 * its speakers" **plus** "everything sent about one of its submissions,
 * sessions or task assignments" — the second read catches mail to a
 * co-speaker who never became an event speaker, and the first catches manual
 * messages that reference nothing. A row satisfying both would otherwise
 * appear twice, so identity is the row id.
 */
export function buildCommunicationLog(...sets: ReadonlyArray<readonly EmailLog[]>): EmailLog[] {
  const byId = new Map<string, EmailLog>();
  for (const set of sets) {
    for (const entry of set) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
}

export interface CommunicationLogFilter {
  /** Exact recipient address — the "communication log per speaker" view. */
  recipient?: string;
  kind?: EmailKind;
}

/** Narrows a built log. Empty/absent criteria match everything. */
export function filterCommunicationLog(
  entries: readonly EmailLog[],
  filter: CommunicationLogFilter,
): EmailLog[] {
  const recipient = filter.recipient?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (recipient && entry.to.toLowerCase() !== recipient) return false;
    if (filter.kind && entry.kind !== filter.kind) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Calendar invite status (spec.md §7 — the update-after-room-change story)
// ---------------------------------------------------------------------------

export interface InviteSummary {
  /** Successful invites recorded for this session, across all recipients. */
  sentCount: number;
  lastSentAt: Date | null;
  /** Distinct addresses that have received an invite for it. */
  recipients: string[];
  failedCount: number;
}

/**
 * Per-session invite history, derived from `email_log` rows for
 * `relatedType: "session"`. Pure, so the page reads the log once and the
 * status of every session on the agenda falls out of it.
 */
export function summarizeSessionInvites(
  logs: readonly EmailLog[],
): Map<string, InviteSummary> {
  const summaries = new Map<string, InviteSummary>();
  for (const row of logs) {
    if (row.kind !== "calendar_invite" || row.relatedType !== "session" || !row.relatedId) continue;
    const summary = summaries.get(row.relatedId) ?? {
      sentCount: 0,
      lastSentAt: null,
      recipients: [],
      failedCount: 0,
    };
    if (row.status === "sent") {
      summary.sentCount += 1;
      if (!summary.lastSentAt || row.sentAt.getTime() > summary.lastSentAt.getTime()) {
        summary.lastSentAt = row.sentAt;
      }
      if (!summary.recipients.includes(row.to)) summary.recipients.push(row.to);
    } else {
      summary.failedCount += 1;
    }
    summaries.set(row.relatedId, summary);
  }
  return summaries;
}

export type InviteBlocker = "unscheduled" | "no_speakers" | "cancelled";

/** Why this session can't be invited on yet, or null when it can. */
export function inviteBlocker(
  session: Pick<Session, "day" | "startTime" | "endTime" | "status">,
  speakerCount: number,
): InviteBlocker | null {
  if (session.status === "cancelled") return "cancelled";
  if (!session.day || !session.startTime || !session.endTime) return "unscheduled";
  if (speakerCount === 0) return "no_speakers";
  return null;
}

/** What an admin is told about a session that can't be invited on. */
export const INVITE_BLOCKER_LABELS: Record<InviteBlocker, string> = {
  unscheduled: "Needs a day and time on the agenda before speakers can be invited.",
  no_speakers: "No speaker is assigned to this session yet.",
  cancelled: "This session is cancelled.",
};

// ---------------------------------------------------------------------------
// The reminder cron (decisions.md D-013)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nudge the same speaker about the same task at most this often (Q4). */
export const DEFAULT_REMINDER_COOLDOWN_DAYS = 3;
/** Only remind about work due inside this window (or already overdue). */
export const DEFAULT_REMINDER_LOOKAHEAD_DAYS = 7;

export const REMINDER_SKIP_REASONS = [
  "completed",
  "event_started",
  "not_due",
  "cooldown",
] as const;
export type ReminderSkipReason = (typeof REMINDER_SKIP_REASONS)[number];

/** Why a candidate was passed over, in the words the admin summary shows. */
export const REMINDER_SKIP_LABELS: Record<ReminderSkipReason, string> = {
  completed: "already done",
  event_started: "event already under way",
  not_due: "not due yet",
  cooldown: "reminded in the last few days",
};

export interface ReminderDecisionInput {
  /** The assignment's current state — a finished task is never nudged. */
  status: TaskAssignmentStatus;
  /** The task's deadline; null means the task has no date to remind about. */
  dueAt: Date | null;
  /** When a `task_reminder` for this exact assignment last went out. */
  lastRemindedAt: Date | null;
  /** The event's first day ("YYYY-MM-DD" in `timezone`); null = undated. */
  eventStartDate: string | null;
  timezone: string;
  now: Date;
  cooldownDays: number;
  lookaheadDays: number;
}

export type ReminderDecision = { send: true } | { send: false; reason: ReminderSkipReason };

const SEND: ReminderDecision = { send: true };

/**
 * Should this speaker be nudged about this task right now?
 *
 * The cadence is questions.md Q4's working assumption, made explicit and
 * pure so it can be tested without a database: **at most one reminder per
 * (task, speaker) every three days, stopping as soon as the task is done or
 * the event has started.** Order matters — the checks run strongest-first, so
 * the reason reported to an admin is the most fundamental one ("already done"
 * beats "reminded recently", which is only true incidentally).
 *
 * Once the event is under way a reminder is worse than useless: the speaker
 * is on site, the deadline it names has passed, and the mail reads as a bot
 * that didn't notice the event started. Admins keep the manual composer for
 * anything genuinely still needed.
 */
export function decideReminder(input: ReminderDecisionInput): ReminderDecision {
  if (input.status === "completed") return { send: false, reason: "completed" };

  if (input.eventStartDate) {
    const eventBegins = zonedWallClockToInstant(input.eventStartDate, "00:00", input.timezone);
    if (input.now.getTime() >= eventBegins.getTime()) {
      return { send: false, reason: "event_started" };
    }
  }

  // No deadline, or a deadline beyond the lookahead: nothing to nudge about.
  if (!input.dueAt) return { send: false, reason: "not_due" };
  const horizon = input.now.getTime() + input.lookaheadDays * DAY_MS;
  if (input.dueAt.getTime() > horizon) return { send: false, reason: "not_due" };

  if (input.lastRemindedAt) {
    const cooledDownAt = input.lastRemindedAt.getTime() + input.cooldownDays * DAY_MS;
    if (input.now.getTime() < cooledDownAt) return { send: false, reason: "cooldown" };
  }

  return SEND;
}

export interface RunReminderJobInput extends Omit<CommsContext, "appUrl"> {
  appUrl?: string;
  /** Remind about anything due within this many days. Default 7. */
  lookaheadDays?: number;
  /** Don't re-remind about the same assignment inside this window. Default 3. */
  cooldownDays?: number;
  /** Restrict the run to one event — the admin "send reminders now" button. */
  eventId?: string;
}

export interface RunReminderJobResult {
  remindersSent: number;
  remindersFailed: number;
  /** Candidates passed over, all reasons combined. */
  skipped: number;
  skippedByReason: Record<ReminderSkipReason, number>;
  /** Who was actually emailed, for the admin's "what did that do?" summary. */
  sentTo: string[];
}

function emptyResult(): RunReminderJobResult {
  return {
    remindersSent: 0,
    remindersFailed: 0,
    skipped: 0,
    skippedByReason: { completed: 0, event_started: 0, not_due: 0, cooldown: 0 },
    sentTo: [],
  };
}

/**
 * Deadline reminders (decisions.md D-013). Runs from custom-worker.ts's
 * `scheduled` handler on the wrangler.jsonc cron, and from the admin
 * Communications screen's "Send reminders now" button — the same function
 * either way, so the button can never drift from what the cron does.
 *
 * Idempotency comes from `email_log` rather than a "reminded" flag: the last
 * recorded `task_reminder` for an assignment is what the cooldown is measured
 * against, so re-running the job — or running it on overlapping schedules —
 * never double-sends. That also means a manual run costs an admin nothing:
 * anything already nudged this week is simply reported as skipped.
 *
 * One `email_log` read per event covers every candidate, rather than one per
 * assignment: the cron runs every 15 minutes and mostly has nothing to do.
 */
export async function runReminderJob(
  input: RunReminderJobInput,
): Promise<RunReminderJobResult> {
  const ctx: CommsContext = { ...input, appUrl: input.appUrl ?? "http://localhost:3000" };
  const now = nowOf(ctx);
  const cooldownDays = input.cooldownDays ?? DEFAULT_REMINDER_COOLDOWN_DAYS;
  const lookaheadDays = input.lookaheadDays ?? DEFAULT_REMINDER_LOOKAHEAD_DAYS;

  const result = emptyResult();

  const allEvents = await ctx.repos.events.listAll();
  const events = input.eventId
    ? allEvents.filter((event) => event.id === input.eventId)
    : allEvents;

  for (const event of events) {
    const [assignments, tasks] = await Promise.all([
      ctx.repos.taskAssignments.listByEvent(event.id),
      ctx.repos.tasks.listByEvent(event.id),
    ]);
    if (assignments.length === 0) continue;

    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const lastRemindedAt = await lastReminderTimes(
      ctx,
      assignments.map((assignment) => assignment.id),
    );

    for (const assignment of assignments) {
      const task = tasksById.get(assignment.taskId);
      if (!task) continue;

      const decision = decideReminder({
        status: assignment.status,
        dueAt: task.dueAt,
        lastRemindedAt: lastRemindedAt.get(assignment.id) ?? null,
        eventStartDate: event.startDate,
        timezone: event.timezone,
        now,
        cooldownDays,
        lookaheadDays,
      });

      if (!decision.send) {
        result.skipped += 1;
        result.skippedByReason[decision.reason] += 1;
        continue;
      }

      const [delivery] = await sendTaskReminder(ctx, { assignmentId: assignment.id });
      if (delivery?.status === "sent") {
        result.remindersSent += 1;
        result.sentTo.push(delivery.to);
      } else {
        result.remindersFailed += 1;
      }
    }
  }
  return result;
}

/** assignment id → when its most recent successful reminder went out. */
async function lastReminderTimes(
  ctx: CommsContext,
  assignmentIds: string[],
): Promise<Map<string, Date>> {
  const latest = new Map<string, Date>();
  if (assignmentIds.length === 0) return latest;

  const rows = await ctx.repos.emailLog.listByRelatedIds("task_assignment", assignmentIds);
  for (const row of rows) {
    if (row.kind !== "task_reminder" || row.status !== "sent" || !row.relatedId) continue;
    const current = latest.get(row.relatedId);
    if (!current || row.sentAt.getTime() > current.getTime()) {
      latest.set(row.relatedId, row.sentAt);
    }
  }
  return latest;
}
