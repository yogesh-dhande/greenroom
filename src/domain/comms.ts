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
  Form,
  Room,
  Session,
  Submission,
  SubmissionDecision,
  SubmissionStatus,
  Task,
  TaskAssignment,
  User,
} from "@/db/entities";
import { pendingReviewers, pendingScorecardsLabel } from "@/domain/round-reminders";
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
  textToHtml,
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

/** The speaker's own edit page for one proposal (src/app/portal/submissions/[id]). */
function submissionUrl(ctx: CommsContext, submissionId: string): string {
  return `${portalUrl(ctx)}/submissions/${submissionId}`;
}

function eventUrl(ctx: CommsContext, event: Event): string {
  return `${trimTrailingSlash(ctx.appUrl)}/e/${event.slug}`;
}

/** A reviewer's own queue for one round (src/app/admin/[eventSlug]/rounds/[roundId]/score). */
function roundQueueUrl(ctx: CommsContext, eventSlug: string, roundId: string): string {
  return `${trimTrailingSlash(ctx.appUrl)}/admin/${eventSlug}/rounds/${roundId}/score`;
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

/**
 * Event-level fields, present on every message. Exported so the composer's
 * on-screen preview (src/app/admin/[eventSlug]/communications/page.tsx) can
 * compute the same real dates/URLs/organizer name the send path uses,
 * instead of `templatePreviewData`'s generic placeholders (decisions.md
 * D-053).
 */
export function eventFields(ctx: CommsContext, event: Event): MergeData {
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

/**
 * The tasks behind a speaker's incomplete assignments, soonest deadline
 * first and undated work last.
 *
 * Pure, and explicitly sorted: repository reads carry no guaranteed order
 * (learnings.md — an unordered `listSpeakerIds()` once made "deterministic"
 * seed logic vary between runs), and a digest that reshuffles its list every
 * week reads as a different email each time.
 */
export function outstandingTasksOf(
  assignments: readonly TaskAssignment[],
  tasks: readonly Task[],
): Task[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return assignments
    .filter((assignment) => assignment.status !== "completed")
    .map((assignment) => tasksById.get(assignment.taskId))
    .filter((task): task is Task => Boolean(task))
    .sort((a, b) => {
      const dueA = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const dueB = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return dueA - dueB || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}

/** "- Upload your headshot (due June 5)" per outstanding item, or "". */
export function formatOutstandingTasks(tasks: readonly Task[], timezone: string): string {
  return tasks
    .map((task) =>
      task.dueAt
        ? `- ${task.title} (due ${formatShortDate(task.dueAt, timezone)})`
        : `- ${task.title}`,
    )
    .join("\n");
}

/** The same list for one speaker, read through the repos. */
async function outstandingTasksFor(
  ctx: CommsContext,
  event: Event,
  speakerId: string,
): Promise<string> {
  const [assignments, tasks] = await Promise.all([
    ctx.repos.taskAssignments.listBySpeaker(speakerId),
    ctx.repos.tasks.listByEvent(event.id),
  ]);
  return formatOutstandingTasks(outstandingTasksOf(assignments, tasks), event.timezone);
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
// Unfinished drafts (decisions.md D-034, D-038, I2)
// ---------------------------------------------------------------------------

/** The public link that reopens a draft. Possession of the token is the auth. */
export function resumeUrl(ctx: CommsContext, formSlug: string, token: string): string {
  return `${trimTrailingSlash(ctx.appUrl)}/submit/${formSlug}/resume/${token}`;
}

interface DraftMailContext {
  submission: Submission;
  speaker: User;
  overrides: TemplateOverrideRow[];
  data: MergeData;
}

/**
 * Everything both draft emails need. Returns null when the draft can't be
 * mailed about at all — no resume token, no form, or no submitter — because
 * that's a state the caller should skip rather than crash the cron on.
 */
async function draftMailContext(
  ctx: CommsContext,
  submissionId: string,
): Promise<DraftMailContext | null> {
  const submission = await ctx.repos.submissions.getById(submissionId);
  if (!submission?.resumeToken) return null;

  const event = await requireEvent(ctx, submission.eventId);
  const [form, speakers, overrides] = await Promise.all([
    ctx.repos.forms.getById(submission.formId),
    submissionSpeakers(ctx, submission.id),
    eventTemplateOverrides(ctx, event.id),
  ]);
  const speaker = speakers[0];
  if (!form || !speaker) return null;

  return {
    submission,
    speaker,
    overrides,
    data: {
      ...eventFields(ctx, event),
      ...speakerFields(speaker),
      submissionTitle: submission.title,
      resumeUrl: resumeUrl(ctx, form.slug, submission.resumeToken),
      changeDueDate: form.closesAt ? formatDeadline(form.closesAt, event.timezone) : "",
    },
  };
}

export interface DraftEmailInput {
  submissionId: string;
}

/**
 * Sends the speaker the link back into a proposal they saved but didn't
 * submit. This *is* the resume mechanism — there are no speaker accounts at
 * submit time (D-007's magic links are for people who already exist), so the
 * emailed token is how a draft is reclaimed on another device or another day.
 * Goes to the submitter alone: a co-speaker shouldn't be told about a proposal
 * that hasn't been sent yet.
 */
export async function sendDraftSavedLink(
  ctx: CommsContext,
  input: DraftEmailInput,
): Promise<CommsDelivery[]> {
  const draft = await draftMailContext(ctx, input.submissionId);
  if (!draft) return [];
  return [
    await deliver(ctx, draft.speaker.email, renderForEvent("draft_saved", draft.overrides, draft.data), {
      kind: "draft_saved",
      relatedType: "submission",
      relatedId: draft.submission.id,
    }),
  ];
}

/** The single "this form closes soon and your draft isn't in" nudge (D-034, D-038). */
export async function sendDraftReminder(
  ctx: CommsContext,
  input: DraftEmailInput,
): Promise<CommsDelivery[]> {
  const draft = await draftMailContext(ctx, input.submissionId);
  if (!draft) return [];
  return [
    await deliver(
      ctx,
      draft.speaker.email,
      renderForEvent("draft_reminder", draft.overrides, draft.data),
      { kind: "draft_reminder", relatedType: "submission", relatedId: draft.submission.id },
    ),
  ];
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
      submissionUrl: submissionUrl(ctx, submission.id),
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
// The weekly task digest (spec.md §6, decisions.md D-039)
// ---------------------------------------------------------------------------

/**
 * The `email_log` identity of "this event's digest to this speaker".
 *
 * A digest is about a (speaker, event) pair, but `email_log` has no event
 * column — a send is addressed to a person, not to an event — and the schema
 * is frozen. Keying the cooldown on the speaker alone would let one event's
 * digest suppress another's every week, so a speaker on two programmes would
 * silently stop hearing from one of them. The pair is therefore the
 * `relatedId`, with `relatedType: "user"` saying what the row is about.
 * Nothing reads these ids back as entity ids: the communication log resolves
 * context for submissions, sessions and task assignments only.
 */
export function taskDigestLogId(eventId: string, speakerId: string): string {
  return `${eventId}:${speakerId}`;
}

interface TaskDigestMail {
  event: Event;
  user: User;
  /** Everything still open for this speaker — never empty. */
  tasks: Task[];
  overrides: TemplateOverrideRow[];
}

async function deliverTaskDigest(ctx: CommsContext, mail: TaskDigestMail): Promise<CommsDelivery> {
  const data: MergeData = {
    ...eventFields(ctx, mail.event),
    ...speakerFields(mail.user),
    outstandingTasks: formatOutstandingTasks(mail.tasks, mail.event.timezone),
  };
  return deliver(ctx, mail.user.email, renderForEvent("task_digest", mail.overrides, data), {
    kind: "task_digest",
    relatedType: "user",
    relatedId: taskDigestLogId(mail.event.id, mail.user.id),
  });
}

export interface TaskDigestInput {
  eventId: string;
  speakerId: string;
}

/**
 * One email listing everything still open on a speaker's checklist for an
 * event (D-039). Returns `[]` — sending nothing at all — when the speaker has
 * nothing outstanding: a digest of an empty list is noise, and "the mail
 * stops when the work is done" is exactly what the decision asks for.
 *
 * `runReminderJob` drives this on a schedule and does its reads in bulk; this
 * entry point exists for one-off sends (scripts/send-test-email.ts).
 */
export async function sendTaskDigest(
  ctx: CommsContext,
  input: TaskDigestInput,
): Promise<CommsDelivery[]> {
  const event = await requireEvent(ctx, input.eventId);
  const [user, assignments, tasks, overrides] = await Promise.all([
    ctx.repos.users.getById(input.speakerId),
    ctx.repos.taskAssignments.listBySpeaker(input.speakerId),
    ctx.repos.tasks.listByEvent(event.id),
    eventTemplateOverrides(ctx, event.id),
  ]);
  if (!user) throw new Error(`Speaker ${input.speakerId} not found`);

  const outstanding = outstandingTasksOf(assignments, tasks);
  if (outstanding.length === 0) return [];

  return [await deliverTaskDigest(ctx, { event, user, tasks: outstanding, overrides })];
}

// ---------------------------------------------------------------------------
// Reviewer completion nudges (decisions.md D-050)
// ---------------------------------------------------------------------------

export interface RoundReminderInput {
  roundId: string;
}

/**
 * Emails every reviewer in a round who still has unfiled scorecards: their
 * pending count and a direct link back to their queue. Sent from the round's
 * assignments page — manual only, no automatic scheduling (D-050); the
 * weekly task digest (D-039) remains the only recurring email.
 *
 * Pending-ness is computed the same way the assignments page's own Progress
 * column is (src/domain/round-reminders.ts wraps `progressByReviewer`), so
 * this never disagrees with what the organizer sees on screen.
 */
export async function sendRoundReminders(
  ctx: CommsContext,
  input: RoundReminderInput,
): Promise<CommsDelivery[]> {
  const round = await ctx.repos.reviewRounds.getById(input.roundId);
  if (!round) throw new Error(`Round ${input.roundId} not found`);

  const event = await requireEvent(ctx, round.eventId);
  const [assignments, overrides] = await Promise.all([
    ctx.repos.reviewRounds.listAssignments(round.id),
    eventTemplateOverrides(ctx, event.id),
  ]);
  const scores = await ctx.repos.reviewRounds.listScoresByAssignments(
    assignments.map((assignment) => assignment.id),
  );
  const scored = new Set(scores.map((score) => score.assignmentId));
  const pending = pendingReviewers(assignments, scored);
  if (pending.length === 0) return [];

  const reviewers = await requireUsers(ctx, pending.map((item) => item.reviewerId));
  const reviewersById = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]));

  const results: CommsDelivery[] = [];
  for (const item of pending) {
    const reviewer = reviewersById.get(item.reviewerId);
    // A deleted or never-created reviewer account isn't a skip an admin can
    // act on; there's simply no address to send to.
    if (!reviewer) continue;

    const data: MergeData = {
      ...eventFields(ctx, event),
      ...speakerFields(reviewer),
      roundName: round.name,
      pendingScorecards: pendingScorecardsLabel(item.pending),
      roundQueueUrl: roundQueueUrl(ctx, event.slug, round.id),
    };
    results.push(
      await deliver(ctx, reviewer.email, renderForEvent("round_reminder", overrides, data), {
        kind: "round_reminder",
        relatedType: "user",
        relatedId: reviewer.id,
      }),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Teammate invitations (decisions.md D-062)
// ---------------------------------------------------------------------------

export interface TeamInviteInput {
  userId: string;
  email: string;
  /** "Admin"/"Reviewer" — the caller resolves this (src/domain/team.ts owns
   * the role vocabulary; this module stays role-agnostic). */
  roleLabel: string;
  eventName: string;
  /** The acting admin's display name (D-053(2)) — never a generic fallback;
   * there's always an admin behind this send. */
  inviterName: string;
}

/**
 * Invites someone onto the team: who invited them, which event, and what
 * role, with a link to the normal magic-link sign-in. No password and no
 * invite-token table (D-062) — the link is just `/login`, the same page
 * everyone else signs in from.
 *
 * Not one of the built-in templates in src/domain/comms-templates.ts: it
 * isn't per-event copy an organizer edits, so it's composed directly here and
 * still sent and logged through the same `deliver` path as every other mail.
 */
export async function sendTeamInvite(ctx: CommsContext, input: TeamInviteInput): Promise<CommsDelivery> {
  const loginUrl = `${trimTrailingSlash(ctx.appUrl)}/login`;
  const subject = `${input.inviterName} invited you to join ${input.eventName} on Greenroom`;
  const text = `Hi,

${input.inviterName} added you to the ${input.eventName} team on Greenroom as a${
    input.roleLabel.toLowerCase().startsWith("a") ? "n" : ""
  } ${input.roleLabel.toLowerCase()}.

Sign in with this email address to get started — there's no password, just a magic link:

${loginUrl}

See you there.`;
  return deliver(
    ctx,
    input.email,
    { subject, text, html: textToHtml(text) },
    { kind: "team_invite", relatedType: "user", relatedId: input.userId },
  );
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
// The reminder cron (decisions.md D-013, D-039)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The cron tick: wrangler.jsonc schedules this job every 15 minutes, so a run
 * *covers* the quarter hour that begins at its scheduled minute.
 */
export const CRON_INTERVAL_MINUTES = 15;
/** Monday, in `Date.getUTCDay()` terms (0 = Sunday). */
export const TASK_DIGEST_UTC_DAY = 1;
/** 07:00 UTC — Sessionboard's own digest hour, matched by D-039. */
export const TASK_DIGEST_UTC_HOUR = 7;

/**
 * Is `now` inside the one cron tick that covers Monday 07:00 UTC?
 *
 * The digest is weekly but the cron fires every 15 minutes, so the schedule
 * has to be expressed as a *window* rather than an instant: the run at 07:00
 * owns 07:00–07:15 and every other run of the week does nothing. Six days of
 * `email_log`-derived cooldown then backs this up, so a redeployed or
 * retried worker firing twice inside the window still sends one digest.
 */
export function isTaskDigestWindow(now: Date): boolean {
  return (
    now.getUTCDay() === TASK_DIGEST_UTC_DAY &&
    now.getUTCHours() === TASK_DIGEST_UTC_HOUR &&
    now.getUTCMinutes() < CRON_INTERVAL_MINUTES
  );
}

/**
 * A speaker gets at most one scheduled digest per event in this window.
 *
 * Six days rather than seven: the Monday window is a week apart, so anything
 * under seven days lets the next Monday through, and the margin absorbs a
 * clock skew or a late-firing cron without skipping a week.
 */
export const TASK_DIGEST_COOLDOWN_DAYS = 6;
/**
 * The admin button's own guard. It bypasses the Monday window on purpose —
 * that's the point of a manual send — but not this: pressing it twice, or two
 * admins pressing it at once, must not mail a speaker twice in a day.
 */
export const MANUAL_TASK_DIGEST_COOLDOWN_HOURS = 24;

export const REMINDER_SKIP_REASONS = [
  "completed",
  /** Digests only: this speaker's checklist is clear, so there's nothing to send. */
  "nothing_outstanding",
  "event_started",
  "not_due",
  "cooldown",
  /** Draft reminders only: the form has already shut (D-034, D-038). */
  "closed",
] as const;
export type ReminderSkipReason = (typeof REMINDER_SKIP_REASONS)[number];

/** Why a candidate was passed over, in the words the admin summary shows. */
export const REMINDER_SKIP_LABELS: Record<ReminderSkipReason, string> = {
  completed: "already done",
  nothing_outstanding: "nothing outstanding",
  event_started: "event already under way",
  not_due: "not due yet",
  cooldown: "already emailed recently",
  closed: "submissions already closed",
};

export type ReminderDecision = { send: true } | { send: false; reason: ReminderSkipReason };

const SEND: ReminderDecision = { send: true };

export interface TaskDigestDecisionInput {
  /** How many of this speaker's tasks for the event are still incomplete. */
  outstandingCount: number;
  /** The event's first day ("YYYY-MM-DD" in `timezone`); null = undated. */
  eventStartDate: string | null;
  timezone: string;
  /** When this speaker's last digest **for this event** went out. */
  lastDigestAt: Date | null;
  now: Date;
  /** Silence owed since `lastDigestAt` — six days on the cron, 24h manually. */
  cooldownMs: number;
}

/**
 * Should this speaker get a digest right now?
 *
 * D-039's model, pure so it can be tested without a database: **one email per
 * speaker per week listing everything still open, stopping as soon as the
 * checklist is clear or the event has started.** The Monday window is *not*
 * checked here — `isTaskDigestWindow` decides whether the job runs the digest
 * pass at all, so the admin's manual button can share this logic while
 * skipping the schedule.
 *
 * Order matters: the reason an admin reads should be the most fundamental one,
 * so "nothing outstanding" beats "the event started", which beats a cooldown
 * that is only incidentally true.
 *
 * Once the event is under way a nudge is worse than useless: the speaker is on
 * site, the deadlines it names have passed, and the mail reads as a bot that
 * didn't notice the event started. Admins keep the manual composer for
 * anything genuinely still needed.
 */
export function decideTaskDigest(input: TaskDigestDecisionInput): ReminderDecision {
  if (input.outstandingCount === 0) return { send: false, reason: "nothing_outstanding" };

  if (input.eventStartDate) {
    const eventBegins = zonedWallClockToInstant(input.eventStartDate, "00:00", input.timezone);
    if (input.now.getTime() >= eventBegins.getTime()) {
      return { send: false, reason: "event_started" };
    }
  }

  if (input.lastDigestAt) {
    const cooledDownAt = input.lastDigestAt.getTime() + input.cooldownMs;
    if (input.now.getTime() < cooledDownAt) return { send: false, reason: "cooldown" };
  }

  return SEND;
}

/**
 * How close a form has to be to closing before an unfinished draft is worth
 * an email. Two days is late enough that the speaker has stopped intending to
 * come back on their own, and early enough that they can still finish.
 */
export const DRAFT_REMINDER_WINDOW_HOURS = 48;

export interface DraftReminderDecisionInput {
  /** The draft's current status — a proposal already sent needs no nudge. */
  status: SubmissionStatus;
  /** The form's close time; null means the call never closes. */
  closesAt: Date | null;
  /** True once a `draft_reminder` for this draft has been logged. */
  alreadyReminded: boolean;
  now: Date;
  windowHours?: number;
}

/**
 * Should this unfinished draft get its one "submissions close soon" email
 * (decisions.md D-034, D-038)?
 *
 * Deliberately **once per draft**, not a cadence: unlike an onboarding task,
 * which the speaker has already committed to, a draft may simply be a proposal
 * someone thought better of. One nudge is a service; three are a nag. That's
 * why idempotency here is "has a `draft_reminder` ever been logged for this
 * submission" rather than the task reminder's rolling cooldown.
 */
export function decideDraftReminder(input: DraftReminderDecisionInput): ReminderDecision {
  if (input.status !== "draft") return { send: false, reason: "completed" };
  if (!input.closesAt) return { send: false, reason: "not_due" };

  const millisLeft = input.closesAt.getTime() - input.now.getTime();
  if (millisLeft < 0) return { send: false, reason: "closed" };
  if (millisLeft > (input.windowHours ?? DRAFT_REMINDER_WINDOW_HOURS) * 60 * 60 * 1000) {
    return { send: false, reason: "not_due" };
  }
  if (input.alreadyReminded) return { send: false, reason: "cooldown" };

  return SEND;
}

export interface RunReminderJobInput extends Omit<CommsContext, "appUrl"> {
  appUrl?: string;
  /** Restrict the run to one event — the admin "Send task digest now" button. */
  eventId?: string;
  /**
   * An admin pressed the button rather than the cron firing: send digests
   * whatever the day and hour, and fall back to the shorter
   * `MANUAL_TASK_DIGEST_COOLDOWN_HOURS` guard against a double-click.
   */
  manual?: boolean;
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
    skippedByReason: {
      completed: 0,
      nothing_outstanding: 0,
      event_started: 0,
      not_due: 0,
      cooldown: 0,
      closed: 0,
    },
    sentTo: [],
  };
}

/**
 * The scheduled mail (decisions.md D-013, D-039). Runs from custom-worker.ts's
 * `scheduled` handler on the wrangler.jsonc cron, and from the admin
 * Communications screen's "Send task digest now" button — the same function
 * either way, so the button can never drift from what the cron does. The
 * button passes `manual: true`, which is the *only* difference between them.
 *
 * Two independent pieces of work: the draft-closing nudge (once per draft,
 * D-038) and the weekly task digest (one per speaker, D-039).
 *
 * Idempotency comes from `email_log` rather than a "reminded" flag: the last
 * recorded send is what each cooldown is measured against, so re-running the
 * job — or running it on overlapping schedules — never double-sends. That
 * also means a manual run costs an admin nothing: anything already mailed is
 * simply reported as skipped.
 */
export async function runReminderJob(input: RunReminderJobInput): Promise<RunReminderJobResult> {
  const ctx: CommsContext = { ...input, appUrl: input.appUrl ?? "http://localhost:3000" };
  const now = nowOf(ctx);
  const result = emptyResult();

  const allEvents = await ctx.repos.events.listAll();
  const events = input.eventId
    ? allEvents.filter((event) => event.id === input.eventId)
    : allEvents;

  await remindAboutDrafts(ctx, events, now, result);
  await sendTaskDigests(ctx, events, now, input.manual ?? false, result);

  return result;
}

/**
 * The digest half of the job (D-039): one email per speaker per event,
 * listing everything still open on their checklist.
 *
 * The schedule is checked once, before any read: on all but one cron run a
 * week this returns immediately, which is what keeps a job firing every 15
 * minutes almost free. An admin's manual run skips the check entirely and
 * relies on the 24-hour cooldown instead.
 *
 * Reads are per event, not per speaker — two list reads plus one `email_log`
 * read cover the whole roster.
 */
async function sendTaskDigests(
  ctx: CommsContext,
  events: Event[],
  now: Date,
  manual: boolean,
  result: RunReminderJobResult,
): Promise<void> {
  if (!manual && !isTaskDigestWindow(now)) return;

  const cooldownMs = manual
    ? MANUAL_TASK_DIGEST_COOLDOWN_HOURS * HOUR_MS
    : TASK_DIGEST_COOLDOWN_DAYS * DAY_MS;

  for (const event of events) {
    const [assignments, tasks] = await Promise.all([
      ctx.repos.taskAssignments.listByEvent(event.id),
      ctx.repos.tasks.listByEvent(event.id),
    ]);
    if (assignments.length === 0) continue;

    // Every speaker with an assignment on this event, including those whose
    // work is all done — they're reported as "nothing outstanding" rather
    // than silently dropped, so an admin can see the run considered them.
    const bySpeaker = new Map<string, TaskAssignment[]>();
    for (const assignment of assignments) {
      const forSpeaker = bySpeaker.get(assignment.speakerId) ?? [];
      forSpeaker.push(assignment);
      bySpeaker.set(assignment.speakerId, forSpeaker);
    }

    const speakerIds = [...bySpeaker.keys()];
    const [lastDigestAt, speakers, overrides] = await Promise.all([
      lastDigestTimes(ctx, event.id, speakerIds),
      requireUsers(ctx, speakerIds),
      eventTemplateOverrides(ctx, event.id),
    ]);
    const usersById = new Map(speakers.map((user) => [user.id, user]));

    for (const speakerId of speakerIds) {
      const outstanding = outstandingTasksOf(bySpeaker.get(speakerId) ?? [], tasks);
      const decision = decideTaskDigest({
        outstandingCount: outstanding.length,
        eventStartDate: event.startDate,
        timezone: event.timezone,
        lastDigestAt: lastDigestAt.get(speakerId) ?? null,
        now,
        cooldownMs,
      });

      if (!decision.send) {
        result.skipped += 1;
        result.skippedByReason[decision.reason] += 1;
        continue;
      }

      // A deleted or never-created speaker account isn't a skip an admin can
      // act on; there's simply no address to send to.
      const user = usersById.get(speakerId);
      if (!user) continue;

      const delivery = await deliverTaskDigest(ctx, {
        event,
        user,
        tasks: outstanding,
        overrides,
      });
      if (delivery.status === "sent") {
        result.remindersSent += 1;
        result.sentTo.push(delivery.to);
      } else {
        result.remindersFailed += 1;
      }
    }
  }
}

/**
 * How many speakers a "Send task digest now" click would actually reach,
 * without sending anything — the number the Communications page's confirm
 * dialog promises before an admin commits to the send.
 *
 * Runs the identical decision `sendTaskDigests` makes (same
 * `outstandingTasksOf` + `decideTaskDigest`, same manual cooldown), just
 * counting `send: true` instead of delivering — so the confirmation can never
 * name a number the actual send wouldn't produce.
 */
export async function previewTaskDigestCount(
  ctx: CommsContext,
  event: Event,
  now: Date = nowOf(ctx),
): Promise<number> {
  const [assignments, tasks] = await Promise.all([
    ctx.repos.taskAssignments.listByEvent(event.id),
    ctx.repos.tasks.listByEvent(event.id),
  ]);
  if (assignments.length === 0) return 0;

  const bySpeaker = new Map<string, TaskAssignment[]>();
  for (const assignment of assignments) {
    const forSpeaker = bySpeaker.get(assignment.speakerId) ?? [];
    forSpeaker.push(assignment);
    bySpeaker.set(assignment.speakerId, forSpeaker);
  }

  const speakerIds = [...bySpeaker.keys()];
  const lastDigestAt = await lastDigestTimes(ctx, event.id, speakerIds);
  const cooldownMs = MANUAL_TASK_DIGEST_COOLDOWN_HOURS * HOUR_MS;

  let count = 0;
  for (const speakerId of speakerIds) {
    const outstanding = outstandingTasksOf(bySpeaker.get(speakerId) ?? [], tasks);
    const decision = decideTaskDigest({
      outstandingCount: outstanding.length,
      eventStartDate: event.startDate,
      timezone: event.timezone,
      lastDigestAt: lastDigestAt.get(speakerId) ?? null,
      now,
      cooldownMs,
    });
    if (decision.send) count += 1;
  }
  return count;
}

/**
 * The draft half of the job (D-034, D-038): one email per unfinished proposal
 * whose form closes inside `DRAFT_REMINDER_WINDOW_HOURS`.
 *
 * Driven from the drafts rather than from the forms because drafts are the
 * rare thing — most runs read one list, find nothing, and stop. Idempotency
 * is the same email_log-derived trick the digest uses, so a re-run (or the
 * admin's manual send) can't double-send.
 */
async function remindAboutDrafts(
  ctx: CommsContext,
  events: Event[],
  now: Date,
  result: RunReminderJobResult,
): Promise<void> {
  const eventIds = new Set(events.map((event) => event.id));
  const drafts = (await ctx.repos.submissions.listAllByStatus("draft")).filter((submission) =>
    eventIds.has(submission.eventId),
  );
  if (drafts.length === 0) return;

  const forms = new Map<string, Form | null>();
  for (const formId of new Set(drafts.map((draft) => draft.formId))) {
    forms.set(formId, await ctx.repos.forms.getById(formId));
  }

  const reminded = new Set(
    (await ctx.repos.emailLog.listByRelatedIds("submission", drafts.map((draft) => draft.id)))
      .filter((row) => row.kind === "draft_reminder" && row.status === "sent")
      .map((row) => row.relatedId),
  );

  for (const draft of drafts) {
    const form = forms.get(draft.formId) ?? null;
    const decision = decideDraftReminder({
      status: draft.status,
      closesAt: form?.closesAt ?? null,
      alreadyReminded: reminded.has(draft.id),
      now,
    });

    if (!decision.send) {
      result.skipped += 1;
      result.skippedByReason[decision.reason] += 1;
      continue;
    }

    const [delivery] = await sendDraftReminder(ctx, { submissionId: draft.id });
    if (delivery?.status === "sent") {
      result.remindersSent += 1;
      result.sentTo.push(delivery.to);
    } else if (delivery) {
      result.remindersFailed += 1;
    }
  }
}

/**
 * speaker id → when this event's most recent digest to them went out.
 *
 * Failed sends are deliberately ignored: a bounce buys nobody a week of
 * silence, so the next run tries again.
 */
async function lastDigestTimes(
  ctx: CommsContext,
  eventId: string,
  speakerIds: string[],
): Promise<Map<string, Date>> {
  const latest = new Map<string, Date>();
  if (speakerIds.length === 0) return latest;

  const bySpeaker = new Map(speakerIds.map((id) => [taskDigestLogId(eventId, id), id]));
  const rows = await ctx.repos.emailLog.listByRelatedIds("user", [...bySpeaker.keys()]);
  for (const row of rows) {
    if (row.kind !== "task_digest" || row.status !== "sent" || !row.relatedId) continue;
    const speakerId = bySpeaker.get(row.relatedId);
    if (!speakerId) continue;
    const current = latest.get(speakerId);
    if (!current || row.sentAt.getTime() > current.getTime()) {
      latest.set(speakerId, row.sentAt);
    }
  }
  return latest;
}
