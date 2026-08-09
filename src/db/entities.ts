/**
 * Zod schemas for every domain entity, and the plain TS types derived from
 * them. This is the single source of truth for entity shapes.
 *
 * Per spec.md's database-abstraction requirement: repository interfaces
 * (src/db/repos/*.ts) and domain services (src/domain/*.ts) must only ever
 * see the types exported from this file — never Drizzle's inferred row
 * types, never raw SQL/D1 types. Only src/db/repos/d1/* is allowed to know
 * that the underlying storage is Drizzle + D1.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const roleSchema = z.enum(["admin", "reviewer", "speaker"]);
export type Role = z.infer<typeof roleSchema>;

/** Calendar day in the event's own timezone, "YYYY-MM-DD". */
export const dayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
/** Wall-clock time in the event's own timezone, "HH:MM" (24h). */
export const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const timestamps = {
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};

/** Drops the server-managed fields when building a create/update payload. */
const omitManaged = { id: true, createdAt: true, updatedAt: true } as const;

// ---------------------------------------------------------------------------
// Event (spec.md §1)
// ---------------------------------------------------------------------------

export const eventSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  startDate: dayStringSchema.nullable(),
  endDate: dayStringSchema.nullable(),
  /** IANA zone; the reference frame for every date/time on this event. */
  timezone: z.string(),
  location: z.string().nullable(),
  ...timestamps,
});
export type Event = z.infer<typeof eventSchema>;
export const newEventSchema = eventSchema.omit(omitManaged);
export type NewEvent = z.infer<typeof newEventSchema>;

// ---------------------------------------------------------------------------
// User (admins, reviewers, speakers — also the better-auth user record)
// ---------------------------------------------------------------------------

export const speakerSocialsSchema = z.object({
  x: z.string().optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  website: z.string().optional(),
});
export type SpeakerSocials = z.infer<typeof speakerSocialsSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  role: roleSchema,
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  socials: speakerSocialsSchema.nullable(),
  image: z.string().nullable(),
  ...timestamps,
});
export type User = z.infer<typeof userSchema>;
export const newUserSchema = userSchema.omit(omitManaged);
export type NewUser = z.infer<typeof newUserSchema>;

// ---------------------------------------------------------------------------
// Track / Room (spec.md §1)
// ---------------------------------------------------------------------------

export const trackSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  color: z.string().nullable(),
  ...timestamps,
});
export type Track = z.infer<typeof trackSchema>;
export const newTrackSchema = trackSchema.omit(omitManaged);
export type NewTrack = z.infer<typeof newTrackSchema>;

export const roomSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  capacity: z.number().int().nullable(),
  ...timestamps,
});
export type Room = z.infer<typeof roomSchema>;
export const newRoomSchema = roomSchema.omit(omitManaged);
export type NewRoom = z.infer<typeof newRoomSchema>;

// ---------------------------------------------------------------------------
// Form (CFP submission forms — spec.md §2, decisions.md D-009)
// ---------------------------------------------------------------------------

export const formFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "email",
  "select",
  "multiselect",
  "checkbox",
  "file",
  "url",
  /**
   * The co-speaker repeater (spec.md §2 — "speaker and co-speaker info,
   * multi-speaker supported, never required"). A composite field whose value
   * is an array of `{name, email, title?, company?}` rows; on save each row
   * becomes a `submission_speakers` row with role `co`. Modelled as a field
   * type rather than a column on `forms` so that turning co-speakers on or
   * off — and where the block appears — is just an edit to the JSON schema.
   */
  "co_speakers",
]);
export type FormFieldType = z.infer<typeof formFieldTypeSchema>;

/**
 * Basic conditional visibility (spec.md §2: "basic conditional logic — no
 * arbitrary rules engine"). One condition per field, referencing one other
 * field by id.
 */
export const formFieldConditionSchema = z.object({
  fieldId: z.string(),
  op: z.enum(["eq", "neq", "in"]),
  value: z.union([z.string(), z.array(z.string())]),
});
export type FormFieldCondition = z.infer<typeof formFieldConditionSchema>;

export const formFieldSchema = z.object({
  /** Stable key; also the key used in `submissions.answers`. */
  id: z.string().min(1),
  type: formFieldTypeSchema,
  label: z.string().min(1),
  helpText: z.string().optional(),
  required: z.boolean().optional(),
  /** Choices for select/multiselect. */
  options: z.array(z.string()).optional(),
  showIf: formFieldConditionSchema.optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formFieldsSchema = z.array(formFieldSchema);

/**
 * Field ids the app treats specially when a submission is saved: they map
 * onto first-class submission columns/joins instead of living only in
 * `answers`. Everything else is a custom field.
 */
export const RESERVED_FIELD_IDS = {
  /** -> submissions.title */
  title: "title",
  /** -> submissions.description */
  description: "description",
  /** multiselect of track names/ids -> submission_tracks */
  tracks: "tracks",
  /** -> the primary speaker's user record */
  speakerName: "speaker_name",
  speakerEmail: "speaker_email",
  /** -> users.bio on the primary speaker, when they don't have one yet */
  speakerBio: "speaker_bio",
  /** file field -> users.headshotUrl on the primary speaker */
  headshot: "headshot",
  /** co_speakers repeater -> submission_speakers rows with role `co` */
  coSpeakers: "co_speakers",
} as const;

export const formSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  /** Public URL segment: /submit/{slug}. */
  slug: z.string().min(1),
  welcomeCopy: z.string().nullable(),
  fields: formFieldsSchema,
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
  confirmationPageContent: z.string().nullable(),
  confirmationEmailSubject: z.string().nullable(),
  confirmationEmailBody: z.string().nullable(),
  isPublished: z.boolean(),
  ...timestamps,
});
export type Form = z.infer<typeof formSchema>;
export const newFormSchema = formSchema.omit(omitManaged);
export type NewForm = z.infer<typeof newFormSchema>;

/** Whether the public form accepts submissions right now (spec.md §2). */
export function isFormOpen(form: Form, now: Date = new Date()): boolean {
  if (!form.isPublished) return false;
  if (form.opensAt && now < form.opensAt) return false;
  if (form.closesAt && now > form.closesAt) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Submission (spec.md §3, §4)
// ---------------------------------------------------------------------------

/** `submitted` is the spec's "unreviewed" state (spec.md §4). */
export const submissionStatusSchema = z.enum([
  "draft",
  "submitted",
  "approved",
  "maybe",
  "denied",
  "withdrawn",
]);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

/** The decisions a reviewer or admin can record (spec.md §4). */
export const submissionDecisionSchema = z.enum(["approved", "maybe", "denied"]);
export type SubmissionDecision = z.infer<typeof submissionDecisionSchema>;

export const submissionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  formId: z.string(),
  title: z.string().min(1),
  description: z.string().nullable(),
  /** Answers to the form's custom fields, keyed by FormField.id. */
  answers: z.record(z.string(), z.unknown()),
  status: submissionStatusSchema,
  decidedBy: z.string().nullable(),
  decidedAt: z.coerce.date().nullable(),
  decisionNote: z.string().nullable(),
  ...timestamps,
});
export type Submission = z.infer<typeof submissionSchema>;
export const newSubmissionSchema = submissionSchema.omit(omitManaged);
export type NewSubmission = z.infer<typeof newSubmissionSchema>;

/** Join row: a submission belongs to one or more tracks (spec.md §4). */
export const submissionTrackSchema = z.object({
  submissionId: z.string(),
  trackId: z.string(),
});
export type SubmissionTrack = z.infer<typeof submissionTrackSchema>;

/** `primary` is the submitter — the one speaker every submission must have. */
export const speakerRoleSchema = z.enum(["primary", "co"]);
export type SpeakerRole = z.infer<typeof speakerRoleSchema>;

export const submissionSpeakerSchema = z.object({
  submissionId: z.string(),
  userId: z.string(),
  role: speakerRoleSchema,
});
export type SubmissionSpeaker = z.infer<typeof submissionSpeakerSchema>;

// ---------------------------------------------------------------------------
// Review (enhancement tier — decisions live on the submission)
// ---------------------------------------------------------------------------

/** A reviewer's non-binding recommendation; the binding decision is the
 * submission's own status. */
export const reviewRecommendationSchema = z.enum(["approve", "maybe", "deny"]);
export type ReviewRecommendation = z.infer<typeof reviewRecommendationSchema>;

export const reviewSchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  reviewerId: z.string(),
  /** Nullable: the MVP flow records a decision with no score (spec.md §4). */
  score: z.number().int().nullable(),
  comment: z.string().nullable(),
  recommendation: reviewRecommendationSchema.nullable(),
  ...timestamps,
});
export type Review = z.infer<typeof reviewSchema>;
export const newReviewSchema = reviewSchema.omit(omitManaged);
export type NewReview = z.infer<typeof newReviewSchema>;

// ---------------------------------------------------------------------------
// Session (scheduled agenda item — spec.md §5, §9). Not an auth session;
// those live in src/db/schema.ts as `authSessions`.
// ---------------------------------------------------------------------------

export const sessionStatusSchema = z.enum(["draft", "confirmed", "cancelled"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  title: z.string().min(1),
  description: z.string().nullable(),
  /** Null for a directly-entered session (e.g. a sponsor speaker). */
  submissionId: z.string().nullable(),
  trackId: z.string().nullable(),
  roomId: z.string().nullable(),
  day: dayStringSchema.nullable(),
  /** Null start/end = unscheduled, i.e. still in the agenda's parking lot. */
  startTime: timeStringSchema.nullable(),
  endTime: timeStringSchema.nullable(),
  status: sessionStatusSchema,
  ...timestamps,
});
export type Session = z.infer<typeof sessionSchema>;
export const newSessionSchema = sessionSchema.omit(omitManaged);
export type NewSession = z.infer<typeof newSessionSchema>;

/** True once the session has a day and a time range on the agenda. */
export function isScheduled(session: Session): boolean {
  return Boolean(session.day && session.startTime && session.endTime);
}

/** Join row: a session can have multiple assigned speakers. */
export const sessionSpeakerSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
});
export type SessionSpeaker = z.infer<typeof sessionSpeakerSchema>;

// ---------------------------------------------------------------------------
// Task / TaskAssignment (speaker onboarding — spec.md §6, §8)
// ---------------------------------------------------------------------------

export const taskTypeSchema = z.enum(["form", "file_request", "confirm"]);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const taskSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  title: z.string().min(1),
  instructions: z.string().nullable(),
  type: taskTypeSchema,
  formId: z.string().nullable(),
  dueAt: z.coerce.date().nullable(),
  autoAssignOnAccept: z.boolean(),
  ...timestamps,
});
export type Task = z.infer<typeof taskSchema>;
export const newTaskSchema = taskSchema.omit(omitManaged);
export type NewTask = z.infer<typeof newTaskSchema>;

export const taskAssignmentStatusSchema = z.enum(["pending", "completed"]);
export type TaskAssignmentStatus = z.infer<typeof taskAssignmentStatusSchema>;

export const taskAssignmentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  speakerId: z.string(),
  status: taskAssignmentStatusSchema,
  completedAt: z.coerce.date().nullable(),
  /** Answers for a `form` task, keyed by FormField.id. */
  responseJson: z.record(z.string(), z.unknown()).nullable(),
  /** Uploaded object URL for a `file_request` task. */
  fileUrl: z.string().nullable(),
  ...timestamps,
});
export type TaskAssignment = z.infer<typeof taskAssignmentSchema>;
export const newTaskAssignmentSchema = taskAssignmentSchema.omit(omitManaged);
export type NewTaskAssignment = z.infer<typeof newTaskAssignmentSchema>;

// ---------------------------------------------------------------------------
// EmailTemplate / EmailLog (spec.md §7)
// ---------------------------------------------------------------------------

export const emailTriggerSchema = z.enum([
  "manual",
  "on_acceptance",
  "on_denial",
  "on_task_assignment",
  "deadline_reminder",
]);
export type EmailTrigger = z.infer<typeof emailTriggerSchema>;

export const emailTemplateSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  subject: z.string().min(1),
  /** Body with `{{mergeField}}` placeholders (speaker name, session, etc). */
  body: z.string(),
  trigger: emailTriggerSchema,
  ...timestamps,
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;
export const newEmailTemplateSchema = emailTemplateSchema.omit(omitManaged);
export type NewEmailTemplate = z.infer<typeof newEmailTemplateSchema>;

export const emailKindSchema = z.enum([
  "magic_link",
  "submission_confirmation",
  "decision",
  "task_reminder",
  "calendar_invite",
  "manual",
]);
export type EmailKind = z.infer<typeof emailKindSchema>;

export const emailRelatedTypeSchema = z.enum([
  "submission",
  "session",
  "task_assignment",
  "user",
]);
export type EmailRelatedType = z.infer<typeof emailRelatedTypeSchema>;

export const emailLogStatusSchema = z.enum(["sent", "failed"]);
export type EmailLogStatus = z.infer<typeof emailLogStatusSchema>;

export const emailLogSchema = z.object({
  id: z.string(),
  to: z.string(),
  subject: z.string(),
  kind: emailKindSchema,
  relatedType: emailRelatedTypeSchema.nullable(),
  relatedId: z.string().nullable(),
  status: emailLogStatusSchema,
  error: z.string().nullable(),
  sentAt: z.coerce.date(),
});
export type EmailLog = z.infer<typeof emailLogSchema>;
export const newEmailLogSchema = emailLogSchema.omit({ id: true });
export type NewEmailLog = z.infer<typeof newEmailLogSchema>;
