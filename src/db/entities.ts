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

export const roleSchema = z.enum(["organizer", "reviewer", "speaker"]);
export type Role = z.infer<typeof roleSchema>;

const timestamps = {
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export const eventStatusSchema = z.enum(["draft", "published", "archived"]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const eventSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  timezone: z.string(),
  startDate: z.coerce.date().nullable(),
  endDate: z.coerce.date().nullable(),
  status: eventStatusSchema,
  ...timestamps,
});
export type Event = z.infer<typeof eventSchema>;
export const newEventSchema = eventSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewEvent = z.infer<typeof newEventSchema>;

// ---------------------------------------------------------------------------
// User (organizers, reviewers, speakers — also the better-auth user record)
// ---------------------------------------------------------------------------

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  role: roleSchema,
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  image: z.string().nullable(),
  ...timestamps,
});
export type User = z.infer<typeof userSchema>;
export const newUserSchema = userSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewUser = z.infer<typeof newUserSchema>;

// ---------------------------------------------------------------------------
// Form (CFP submission forms — spec.md §1)
// ---------------------------------------------------------------------------

export const formStatusSchema = z.enum(["draft", "open", "closed"]);
export type FormStatus = z.infer<typeof formStatusSchema>;

/** A single field in a form's JSON schema. Kept intentionally small — see
 * decisions.md D-009 (purpose-built schema over JSON Schema). */
export const formFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum([
    "text",
    "textarea",
    "select",
    "multiselect",
    "checkbox",
    "file",
    "email",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  /** Conditional visibility: show this field only if `field` === `equals`. */
  showIf: z.object({ field: z.string(), equals: z.string() }).optional(),
  /** If set, the value of this field routes the submission into a category. */
  routesCategory: z.boolean().optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formSchemaDefinitionSchema = z.object({
  fields: z.array(formFieldSchema),
});
export type FormSchemaDefinition = z.infer<typeof formSchemaDefinitionSchema>;

export const formSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  /** Stored as JSON text in D1; parses to FormSchemaDefinition. */
  schema: formSchemaDefinitionSchema,
  status: formStatusSchema,
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
  ...timestamps,
});
export type Form = z.infer<typeof formSchema>;
export const newFormSchema = formSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewForm = z.infer<typeof newFormSchema>;

// ---------------------------------------------------------------------------
// Submission (spec.md §1, §4)
// ---------------------------------------------------------------------------

export const submissionStatusSchema = z.enum([
  "draft",
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "waitlisted",
]);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

export const submissionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  formId: z.string(),
  submitterId: z.string(),
  title: z.string().min(1),
  category: z.string().nullable(),
  status: submissionStatusSchema,
  /** Stored as JSON text in D1; keys match the form's field keys. */
  answers: z.record(z.string(), z.unknown()),
  ...timestamps,
});
export type Submission = z.infer<typeof submissionSchema>;
export const newSubmissionSchema = submissionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewSubmission = z.infer<typeof newSubmissionSchema>;

// ---------------------------------------------------------------------------
// Review (spec.md §4)
// ---------------------------------------------------------------------------

export const reviewSchema = z.object({
  id: z.string(),
  submissionId: z.string(),
  reviewerId: z.string(),
  round: z.number().int().min(1),
  /** Stored as JSON text in D1; keys are scoring-criteria ids. */
  scores: z.record(z.string(), z.number()),
  comments: z.string().nullable(),
  ...timestamps,
});
export type Review = z.infer<typeof reviewSchema>;
export const newReviewSchema = reviewSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewReview = z.infer<typeof newReviewSchema>;

// ---------------------------------------------------------------------------
// Track / Room (spec.md §5)
// ---------------------------------------------------------------------------

export const trackSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  color: z.string().nullable(),
  ...timestamps,
});
export type Track = z.infer<typeof trackSchema>;
export const newTrackSchema = trackSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewTrack = z.infer<typeof newTrackSchema>;

export const roomSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  capacity: z.number().int().nullable(),
  ...timestamps,
});
export type Room = z.infer<typeof roomSchema>;
export const newRoomSchema = roomSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewRoom = z.infer<typeof newRoomSchema>;

// ---------------------------------------------------------------------------
// Session (scheduled agenda item — spec.md §5). Not to be confused with an
// auth session; those live in src/db/schema.ts as `authSessions`.
// ---------------------------------------------------------------------------

export const sessionStatusSchema = z.enum(["scheduled", "cancelled"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  submissionId: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  startTime: z.coerce.date().nullable(),
  endTime: z.coerce.date().nullable(),
  roomId: z.string().nullable(),
  trackId: z.string().nullable(),
  status: sessionStatusSchema,
  ...timestamps,
});
export type Session = z.infer<typeof sessionSchema>;
export const newSessionSchema = sessionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewSession = z.infer<typeof newSessionSchema>;

/** Join row: a session can have multiple assigned speakers. */
export const sessionSpeakerSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  userId: z.string(),
});
export type SessionSpeaker = z.infer<typeof sessionSpeakerSchema>;
export const newSessionSpeakerSchema = sessionSpeakerSchema.omit({
  id: true,
});
export type NewSessionSpeaker = z.infer<typeof newSessionSpeakerSchema>;

// ---------------------------------------------------------------------------
// Task / TaskAssignment (onboarding — spec.md §2, §6)
// ---------------------------------------------------------------------------

export const taskAssignmentStatusSchema = z.enum([
  "pending",
  "in_progress",
  "complete",
]);
export type TaskAssignmentStatus = z.infer<typeof taskAssignmentStatusSchema>;

export const taskSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
  /** Optional form (e.g. speaker agreement) attached to this task. */
  formId: z.string().nullable(),
  dueDate: z.coerce.date().nullable(),
  ...timestamps,
});
export type Task = z.infer<typeof taskSchema>;
export const newTaskSchema = taskSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewTask = z.infer<typeof newTaskSchema>;

export const taskAssignmentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  userId: z.string(),
  status: taskAssignmentStatusSchema,
  completedAt: z.coerce.date().nullable(),
  ...timestamps,
});
export type TaskAssignment = z.infer<typeof taskAssignmentSchema>;
export const newTaskAssignmentSchema = taskAssignmentSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewTaskAssignment = z.infer<typeof newTaskAssignmentSchema>;

// ---------------------------------------------------------------------------
// EmailTemplate / EmailLog (spec.md §3)
// ---------------------------------------------------------------------------

export const emailTriggerSchema = z.enum([
  "manual",
  "on_acceptance",
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
export const newEmailTemplateSchema = emailTemplateSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type NewEmailTemplate = z.infer<typeof newEmailTemplateSchema>;

export const emailLogStatusSchema = z.enum(["sent", "failed"]);
export type EmailLogStatus = z.infer<typeof emailLogStatusSchema>;

export const emailLogSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  templateId: z.string().nullable(),
  subject: z.string(),
  status: emailLogStatusSchema,
  sentAt: z.coerce.date(),
});
export type EmailLog = z.infer<typeof emailLogSchema>;
export const newEmailLogSchema = emailLogSchema.omit({ id: true });
export type NewEmailLog = z.infer<typeof newEmailLogSchema>;
