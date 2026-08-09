/**
 * Serializable view models passed from the Communications page (a server
 * component) to its client islands.
 *
 * Deliberately dependency-free at runtime: every import here is `import
 * type`, which TypeScript erases, so nothing in this module can pull
 * src/domain/comms.ts — and with it the SendGrid transport and the
 * repository layer — into the browser bundle (see learnings.md, "A `use
 * client` import chain can pull the email transport into the browser
 * bundle"). Anything the client needs as a *value* is declared here rather
 * than imported.
 *
 * Dates cross as ISO strings and are formatted client-side, because a server
 * component can't hand a `Date` to a client component without serialization
 * surprises.
 */
import type { EmailKind } from "@/db/entities";
import type { CommsTemplateId, MergeField } from "@/domain/comms-templates";

/** A person the composer can write to. */
export interface SpeakerOption {
  id: string;
  name: string;
  email: string;
  /** True once they're on a session — the rest are still just proposers. */
  confirmed: boolean;
}

/** One row of the communication log. */
export interface LogRow {
  id: string;
  to: string;
  /** Resolved display name, when the address belongs to someone we know. */
  toName: string | null;
  subject: string;
  kind: EmailKind;
  status: "sent" | "failed";
  error: string | null;
  /** ISO 8601, for the `<time>` element's machine-readable value. */
  sentAt: string;
  /**
   * "Jun 16, 10:04 AM PDT" — formatted on the server in the *event's*
   * timezone. Timestamps are never formatted in the browser: the server would
   * render UTC and the client the viewer's zone, and the mismatch is a
   * hydration error. The event's zone is also the right frame for an event
   * tool (it's the one every other date on the site uses).
   */
  sentAtLabel: string;
  /** "Retrieval that survives production traffic" — what it was about. */
  context: string | null;
}

/** A built-in template plus the event's override of it, if any. */
export interface TemplateRow {
  id: CommsTemplateId;
  /** The built-in's human name — what the editor lists. */
  name: string;
  description: string;
  /** Current copy: the override when there is one, else the built-in. */
  subject: string;
  body: string;
  /** The built-in copy, for "revert to Greenroom's wording". */
  defaultSubject: string;
  defaultBody: string;
  isOverride: boolean;
  /** Merge fields this template's send path can actually fill in. */
  availableFields: MergeField[];
}

/** A session on the invite panel. */
export interface InviteRow {
  sessionId: string;
  title: string;
  /** "Tue, Jun 16 · 10:00 AM – 10:45 AM", or null when unscheduled. */
  when: string | null;
  room: string | null;
  speakers: string[];
  sentCount: number;
  /** Server-formatted in the event's timezone; null when none has gone out. */
  lastSentLabel: string | null;
  /** Why it can't be sent yet, already in plain words. Null = ready to send. */
  blockedReason: string | null;
}

/** Merge fields a one-off composed message can use. */
export type ManualField = MergeField;

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  magic_link: "Sign-in link",
  submission_confirmation: "Submission received",
  decision: "Decision",
  change_request: "Change request",
  task_reminder: "Task reminder",
  calendar_invite: "Calendar invite",
  manual: "One-off message",
};

/** Filter order in the log's Kind dropdown — most interesting first. */
export const LOG_KIND_ORDER: EmailKind[] = [
  "decision",
  "change_request",
  "task_reminder",
  "calendar_invite",
  "manual",
  "submission_confirmation",
  "magic_link",
];
