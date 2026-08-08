/**
 * Comms domain service — templated speaker emails, deadline reminders, and
 * the communication log (spec.md §3). Pure TypeScript: no datastore
 * imports. Depends only on the storage-agnostic Repos bundle
 * (src/db/repos/index.ts) and an EmailSender (src/lib/email.ts), both of
 * which are plain interfaces — never a concrete D1/Drizzle/Resend type.
 */
import type { EmailTemplate, Task, TaskAssignment, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import type { EmailSender } from "@/lib/email";

/** Merge fields available to email templates (spec.md §3: "speaker name,
 * session, deadlines"). */
export interface MergeFields {
  speakerName: string;
  [key: string]: string;
}

/** Substitutes `{{mergeField}}` placeholders in a template body/subject. */
export function renderTemplate(template: string, fields: MergeFields): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) =>
    key in fields ? fields[key] : `{{${key}}}`,
  );
}

export interface ReminderCandidate {
  assignment: TaskAssignment;
  task: Task;
  user: User;
}

/** Builds the subject/body for a single overdue-task reminder. */
export function buildReminderEmail(candidate: ReminderCandidate): {
  subject: string;
  html: string;
} {
  // TODO: pull the event's configured "deadline_reminder" EmailTemplate
  // (repos.emailTemplates.listByTrigger) instead of hardcoding copy, and
  // run it through renderTemplate with the task/deadline merge fields.
  return {
    subject: `Reminder: "${candidate.task.title}" is due soon`,
    html: `<p>Hi ${candidate.user.name ?? "there"},</p><p>Your task "${candidate.task.title}" is still incomplete.</p>`,
  };
}

export interface RunReminderJobInput {
  repos: Repos;
  sender: EmailSender;
  /** Defaults to now; overridable for tests. */
  now?: Date;
}

export interface RunReminderJobResult {
  remindersSent: number;
}

/**
 * The cron-triggered reminder job (decisions.md D-013, spec.md §3
 * "Automatic reminders"). Wired up in custom-worker.ts's `scheduled`
 * handler, which runs every 15 minutes per wrangler.jsonc's trigger.
 */
export async function runReminderJob(
  input: RunReminderJobInput,
): Promise<RunReminderJobResult> {
  // TODO:
  //  1. repos.events.listAll() and, per event, repos.taskAssignments
  //     .listIncompleteDueBefore(eventId, lookaheadWindow) to find who's at risk.
  //  2. Load each assignment's Task and User, build a ReminderCandidate.
  //  3. buildReminderEmail(candidate), then input.sender.send(...).
  //  4. repos.emailLog.create(...) per send, for the per-speaker comm log.
  //  Idempotency (decisions.md D-013): only remind once per
  //  task/speaker/deadline window — track that via emailLog lookups rather
  //  than a separate "reminded" flag.
  void input;
  return { remindersSent: 0 };
}

export interface AcceptanceEmailInput {
  user: User;
  template: EmailTemplate;
  fields: MergeFields;
}

/** Sends a manually- or automatically-triggered templated email (e.g. on
 * acceptance, on task assignment) and logs it. */
export async function sendTemplatedEmail(
  { user, template, fields }: AcceptanceEmailInput,
  sender: EmailSender,
): Promise<{ id: string }> {
  const subject = renderTemplate(template.subject, fields);
  const html = renderTemplate(template.body, fields);
  return sender.send({ to: user.email, subject, html });
}
