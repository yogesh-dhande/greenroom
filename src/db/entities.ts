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
  /** Whether the public program is live (decisions.md D-056). Required, with
   * no zod default: `newEventSchema.partial()` (the settings update path)
   * would otherwise materialize the default into every patch and quietly
   * unpublish a live program on an unrelated edit. Create paths state the
   * value they want. */
  programPublished: z.boolean(),
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
  /**
   * The links a speaker maintains on their own profile (spec.md §6 —
   * "social/web links"), and what the public gallery renders. First-class
   * nullable columns rather than keys inside `socials` because they're
   * edited, validated, and displayed individually; `socials` stays as the
   * loose bag for anything imported from elsewhere.
   */
  websiteUrl: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  socials: speakerSocialsSchema.nullable(),
  image: z.string().nullable(),
  ...timestamps,
});
export type User = z.infer<typeof userSchema>;
export const newUserSchema = userSchema.omit(omitManaged);
export type NewUser = z.infer<typeof newUserSchema>;

// ---------------------------------------------------------------------------
// API credentials (authenticated REST API and remote MCP server)
// ---------------------------------------------------------------------------

/**
 * External credentials deliberately have only two permission levels. A
 * `write` key always includes read access; there is no write-only state.
 */
export const apiCredentialPermissionSchema = z.enum(["read", "write"]);
export type ApiCredentialPermission = z.infer<typeof apiCredentialPermissionSchema>;

/** `all` includes events created after the key; `selected` is a fixed allowlist. */
export const apiCredentialEventAccessSchema = z.enum(["all", "selected"]);
export type ApiCredentialEventAccess = z.infer<typeof apiCredentialEventAccessSchema>;

/**
 * Storage-agnostic view of an API key. The stored SHA-256 digest is omitted on
 * purpose: callers can look a key up through ApiCredentialsRepo, but can never
 * accidentally serialize even its verifier. The full secret is returned only
 * by the creation workflow and is never part of this entity.
 */
export const apiCredentialSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  label: z.string().trim().min(1).max(80),
  /** Safe identifying fragment, including the `gr_` prefix. */
  keyPrefix: z.string().startsWith("gr_"),
  permission: apiCredentialPermissionSchema,
  eventAccess: apiCredentialEventAccessSchema,
  /** Empty for `all`; non-empty and de-duplicated for `selected`. */
  eventIds: z.array(z.string()),
  expiresAt: z.coerce.date(),
  revoked: z.boolean(),
  lastUsedAt: z.coerce.date().nullable(),
  ...timestamps,
});
export type ApiCredential = z.infer<typeof apiCredentialSchema>;

/** Persistence payload. `secretHash` is write-only and never comes back. */
export const newApiCredentialSchema = apiCredentialSchema
  .omit({
    id: true,
    revoked: true,
    lastUsedAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    secretHash: z.string().min(1),
  });
export type NewApiCredential = z.infer<typeof newApiCredentialSchema>;

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
  /**
   * Character cap for the free-text types (`text`, `textarea`, `url`,
   * `email`). Enforced in the browser *and* on the server by
   * `buildFormValidator` (decisions.md D-034, D-038: the CFP form must not accept
   * an answer it will later reject). Absent means no cap.
   */
  maxLength: z.number().int().positive().optional(),
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

/**
 * What a submission to this form becomes (decisions.md D-041).
 *
 * `abstract` is the review pipeline every form used before this existed: a
 * proposal queues for the committee and becomes a session only if it's
 * accepted. `session` skips all of that — the proposal *is* the session, for
 * invited talks and sponsor slots that were agreed before the form was sent.
 */
export const formTypeSchema = z.enum(["abstract", "session"]);
export type FormType = z.infer<typeof formTypeSchema>;

export const formSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  /** Public URL segment: /submit/{slug}. */
  slug: z.string().min(1),
  /** Review pipeline or direct-to-session (D-041). Existing forms are
   * `abstract`, which is what every form did before the switch existed. */
  type: formTypeSchema,
  welcomeCopy: z.string().nullable(),
  fields: formFieldsSchema,
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
  confirmationPageContent: z.string().nullable(),
  confirmationEmailSubject: z.string().nullable(),
  confirmationEmailBody: z.string().nullable(),
  /**
   * How many proposals one speaker may have on this form (decisions.md D-034,
   * D-038). Null means unlimited. Counted by submitter email across every status
   * except `withdrawn`, so a withdrawn proposal frees a slot.
   */
  maxSubmissionsPerSpeaker: z.number().int().positive().nullable(),
  isPublished: z.boolean(),
  ...timestamps,
});
export type Form = z.infer<typeof formSchema>;
export const newFormSchema = formSchema.omit(omitManaged);
export type NewForm = z.infer<typeof newFormSchema>;

/**
 * True when a submission to this form becomes a confirmed session the moment
 * it arrives, with no review step (decisions.md D-041).
 */
export function createsSessionsDirectly(form: Pick<Form, "type">): boolean {
  return form.type === "session";
}

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
  /**
   * Secret for the emailed "finish your draft" link (decisions.md D-034, D-038).
   * There are no speaker accounts at submit time, so possession of the token
   * *is* the authorisation to reopen that draft — same trust model as a magic
   * link. Set when a draft is saved and kept afterwards so the resume link a
   * speaker already has in their inbox keeps resolving to their proposal.
   */
  resumeToken: z.string().nullable(),
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
// Review rounds (spec.md "Important" — multi-round scored evaluations,
// decisions.md D-031). A parallel structure to the single-layer reviewer
// recommendation above: rounds have their own dates, their own scorecard, and
// their own per-reviewer assignments. Nothing in the accept/decline flow
// depends on them.
// ---------------------------------------------------------------------------

/** The three question types a scorecard can ask (D-031). */
export const scorecardCriterionTypeSchema = z.enum(["number", "select", "text"]);
export type ScorecardCriterionType = z.infer<typeof scorecardCriterionTypeSchema>;

/**
 * One line on a round's scorecard. Same "questions are data" model as the CFP
 * form fields (D-009): changing a scorecard is an edit to JSON, not a
 * migration.
 */
export const scorecardCriterionSchema = z.object({
  /** Stable key; also the key used in `RoundScore.values`. */
  id: z.string().min(1),
  label: z.string().min(1),
  type: scorecardCriterionTypeSchema,
  helpText: z.string().optional(),
  /** Inclusive rating range for a `number` criterion (e.g. 1–5). */
  min: z.number().optional(),
  max: z.number().optional(),
  /** Choices for a `select` criterion. */
  options: z.array(z.string()).optional(),
  /**
   * Relative importance of a `number` criterion in the aggregate; defaults to
   * 1. Ignored for dropdown/free-text criteria, which carry judgement rather
   * than a measurement (src/domain/rounds.ts).
   */
  weight: z.number().optional(),
});
export type ScorecardCriterion = z.infer<typeof scorecardCriterionSchema>;

export const scorecardSchema = z.array(scorecardCriterionSchema);

export const reviewRoundSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
  /** Null means "no boundary on that side" — same convention as `forms`. */
  opensAt: z.coerce.date().nullable(),
  closesAt: z.coerce.date().nullable(),
  criteria: scorecardSchema,
  /**
   * "Hide speaker identity" (decisions.md D-049). Off by default; editable on
   * round setup. Consumed only by the reviewer-facing queue and scorecard —
   * see the blind-review section of src/domain/rounds.ts for what identity is.
   */
  blindReview: z.boolean(),
  ...timestamps,
});
export type ReviewRound = z.infer<typeof reviewRoundSchema>;
export const newReviewRoundSchema = reviewRoundSchema.omit(omitManaged);
export type NewReviewRound = z.infer<typeof newReviewRoundSchema>;

/**
 * `recused` is a conflict of interest the reviewer declared: the submission
 * stays on their queue, marked, but drops out of the work they still owe and
 * out of the aggregate.
 */
export const roundAssignmentStatusSchema = z.enum(["pending", "done", "recused"]);
export type RoundAssignmentStatus = z.infer<typeof roundAssignmentStatusSchema>;

/** One unit of review work: this reviewer, this submission, in this round. */
export const roundAssignmentSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  submissionId: z.string(),
  reviewerId: z.string(),
  status: roundAssignmentStatusSchema,
  /** Why the reviewer stepped back, when they did. */
  recusalReason: z.string().nullable(),
  ...timestamps,
});
export type RoundAssignment = z.infer<typeof roundAssignmentSchema>;
export const newRoundAssignmentSchema = roundAssignmentSchema.omit(omitManaged);
export type NewRoundAssignment = z.infer<typeof newRoundAssignmentSchema>;

/** A filled-in scorecard, keyed by `ScorecardCriterion.id`. One per assignment. */
export const roundScoreSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  values: z.record(z.string(), z.unknown()),
  submittedAt: z.coerce.date(),
  ...timestamps,
});
export type RoundScore = z.infer<typeof roundScoreSchema>;
export const newRoundScoreSchema = roundScoreSchema.omit(omitManaged);
export type NewRoundScore = z.infer<typeof newRoundScoreSchema>;

// ---------------------------------------------------------------------------
// Session (scheduled agenda item — spec.md §5, §9). Not an auth session;
// those live in src/db/schema.ts as `authSessions`.
// ---------------------------------------------------------------------------

export const sessionStatusSchema = z.enum(["draft", "confirmed", "cancelled"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * Editorial approval of a session's content (decisions.md D-072) — separate
 * from `sessionStatusSchema` above, which is the scheduling state conflict
 * detection reads. Only `approved` content reaches a public surface
 * (`isPubliclyVisible` in src/domain/program.ts).
 */
export const sessionContentStatusSchema = z.enum(["draft", "in_review", "approved"]);
export type SessionContentStatus = z.infer<typeof sessionContentStatusSchema>;

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
  /** Defaulted so a payload written before D-072 still parses — and lands on
   * the same value the column defaults to. */
  contentStatus: sessionContentStatusSchema.default("approved"),
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
// SessionRevision (decisions.md D-071) — append-only history of a session's
// abstract. Speaker profile fields deliberately get none.
// ---------------------------------------------------------------------------

export const sessionRevisionFieldSchema = z.enum(["abstract"]);
export type SessionRevisionField = z.infer<typeof sessionRevisionFieldSchema>;

export const sessionRevisionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  field: sessionRevisionFieldSchema,
  /** Null when the field was empty before this edit (a first set). */
  priorValue: z.string().nullable(),
  /** Null when the edit cleared the field. */
  newValue: z.string().nullable(),
  /** Null once the account that made the edit is gone; the history stays. */
  authorUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type SessionRevision = z.infer<typeof sessionRevisionSchema>;
export const newSessionRevisionSchema = sessionRevisionSchema.omit({
  id: true,
  createdAt: true,
});
export type NewSessionRevision = z.infer<typeof newSessionRevisionSchema>;

// ---------------------------------------------------------------------------
// EventSpeaker (spec.md §5, decisions.md D-051) — a speaker's record at one
// event: the organizer's private notes about them, and the membership row
// that puts a hand-added speaker on the roster.
// ---------------------------------------------------------------------------

/**
 * An organizer's explicit confirmation answer for one speaker at one event
 * (decisions.md D-068). Absence of a value — not a third member of this enum
 * — is what "nobody has said, keep deriving it" looks like.
 */
export const speakerConfirmationSchema = z.enum(["confirmed", "declined"]);
export type SpeakerConfirmation = z.infer<typeof speakerConfirmationSchema>;

export const eventSpeakerSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  /** Organizer-only logistics prose; never rendered to the speaker. */
  notes: z.string().nullable(),
  /** Stored confirmation, or null for "automatic" — the derived value from
   * session attachment (decisions.md D-068). */
  confirmationStatus: speakerConfirmationSchema.nullable(),
  ...timestamps,
});
export type EventSpeaker = z.infer<typeof eventSpeakerSchema>;

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
// FileVersion / FileComment (deliverables — spec.md §6, decisions.md D-054)
// ---------------------------------------------------------------------------

/**
 * What a tracked upload belongs to: an onboarding assignment, or a speaker's
 * profile (their headshot). The scope picks which owner id the row carries.
 */
export const fileVersionScopeSchema = z.enum(["assignment", "profile"]);
export type FileVersionScope = z.infer<typeof fileVersionScopeSchema>;

/**
 * One tracked upload. Immutable — a replacement is a new row, never an edit —
 * so there is no `updatedAt` and no `NewFileVersion` update type.
 *
 * `assignmentId` is set for `assignment` rows and `ownerUserId` for `profile`
 * rows; the other is null. `uploadedBy` is who sent the file, which for a
 * profile headshot may be an organizer rather than the owner.
 */
export const fileVersionSchema = z.object({
  id: z.string(),
  scope: fileVersionScopeSchema,
  assignmentId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  /** Stored object key; null for a file that only exists as an absolute URL. */
  fileKey: z.string().nullable(),
  url: z.string(),
  filename: z.string(),
  uploadedBy: z.string(),
  createdAt: z.coerce.date(),
});
export type FileVersion = z.infer<typeof fileVersionSchema>;
/**
 * `createdAt` is writable on create only: replacing a file that predates
 * the versions table records the existing upload under its own date.
 *
 * `scope`, `assignmentId` and `ownerUserId` are optional so an assignment
 * upload still reads as `{ assignmentId, ... }` — the default scope is
 * `assignment`, and the ids default to null.
 */
export const newFileVersionSchema = fileVersionSchema
  .omit({ id: true, createdAt: true })
  .extend({
    scope: fileVersionScopeSchema.optional(),
    assignmentId: z.string().nullable().optional(),
    ownerUserId: z.string().nullable().optional(),
    createdAt: z.coerce.date().optional(),
  });
export type NewFileVersion = z.infer<typeof newFileVersionSchema>;

/** A comment on a deliverable, from either side (append-only). */
export const fileCommentSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  authorId: z.string(),
  body: z.string().min(1),
  createdAt: z.coerce.date(),
});
export type FileComment = z.infer<typeof fileCommentSchema>;
export const newFileCommentSchema = fileCommentSchema.omit({ id: true, createdAt: true });
export type NewFileComment = z.infer<typeof newFileCommentSchema>;

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
  /** "We need something from you before review continues" (decisions.md D-023). */
  "change_request",
  /**
   * The retired per-task nudge (one email per outstanding task, every three
   * days). Superseded by `task_digest` (D-039) but kept as a kind so the
   * `email_log` history it wrote still renders in the communication log.
   */
  "task_reminder",
  /** "Everything still open on your speaker checklist" — the weekly
   * per-speaker digest sent Mondays 07:00 UTC (D-039). */
  "task_digest",
  /** "Something new is waiting on your checklist" — the one-time notification
   * D-039 pairs with the weekly digest, sent when tasks are assigned to a
   * speaker. Its own kind so the log distinguishes "we told them about this"
   * from the recurring digest. */
  "task_assigned",
  /** "Here's the link back to your unfinished proposal" (D-034, D-038). */
  "draft_saved",
  /** "Your draft proposal — this form closes soon" (D-034, D-038). */
  "draft_reminder",
  /** "You still have N scorecards to file in this round" — the manual
   * reviewer completion nudge from a round's assignments page (D-050). */
  "round_reminder",
  "calendar_invite",
  /** "You've been added to the team" — sent from the Team page's "Add a
   * teammate" form, pointing at the normal magic-link sign-in (D-062). */
  "team_invite",
  /** "Your speaker portal is ready" — the per-speaker portal invitation sent
   * from a speaker's record page, pointing at the normal magic-link portal
   * sign-in (D-070). Its own kind so the log answers "who was invited, and
   * when" instead of burying invitations in `manual`. */
  "portal_invite",
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

// ---------------------------------------------------------------------------
// Org-level speaker CRM (spec.md "Org-level speaker CRM", decisions.md D-077).
// Every entity below is organization-scoped — none of them carries an event
// id, which is what separates them from the event-scoped speaker record
// (`EventSpeaker`, D-051) that keeps its own per-event logistics notes.
// ---------------------------------------------------------------------------

/** How a contact got into the registry: typed in, or CSV-imported. */
export const contactSourceSchema = z.enum(["manual", "import"]);
export type ContactSource = z.infer<typeof contactSourceSchema>;

/**
 * A registry row: this person is an explicitly-added org contact.
 *
 * The directory is the *union* of everyone who speaks at an event and everyone
 * with a row here, so the absence of a row says nothing about whether someone
 * is in the directory — only about how they got there.
 */
export const contactSchema = z.object({
  userId: z.string(),
  source: contactSourceSchema,
  createdAt: z.coerce.date(),
});
export type Contact = z.infer<typeof contactSchema>;

/**
 * One tag on one contact. `label` is always stored normalized
 * (`normalizeTagLabel` in src/domain/crm.ts), so comparing two labels is a
 * plain string comparison everywhere.
 */
export const contactTagSchema = z.object({
  userId: z.string(),
  label: z.string().min(1),
  createdAt: z.coerce.date(),
});
export type ContactTag = z.infer<typeof contactTagSchema>;

/** An org-level internal note about a contact; append-only. */
export const contactNoteSchema = z.object({
  id: z.string(),
  /** The contact the note is about. */
  userId: z.string(),
  /** Null once the author's account is gone; the note stays (cf. D-071). */
  authorUserId: z.string().nullable(),
  body: z.string().min(1),
  createdAt: z.coerce.date(),
});
export type ContactNote = z.infer<typeof contactNoteSchema>;
export const newContactNoteSchema = contactNoteSchema.omit({ id: true, createdAt: true });
export type NewContactNote = z.infer<typeof newContactNoteSchema>;

/** The sourcing pipeline's stages, in board order (D-077). */
export const pipelineStageSchema = z.enum([
  "identified",
  "contacted",
  "interested",
  "confirmed",
  "declined",
]);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

/** One contact's position on the sourcing board; at most one per contact. */
export const pipelineCardSchema = z.object({
  id: z.string(),
  userId: z.string(),
  stage: pipelineStageSchema,
  /** Optional fit score recorded at enrol time; null means unscored. */
  score: z.number().int().nullable(),
  rationale: z.string().nullable(),
  ...timestamps,
});
export type PipelineCard = z.infer<typeof pipelineCardSchema>;

/**
 * One entry in a card's stage history. `fromStage` is null for the enrol
 * event; every later row carries both ends of the move.
 */
export const pipelineStageEventSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  fromStage: pipelineStageSchema.nullable(),
  toStage: pipelineStageSchema,
  /** Null once the actor's account is gone; the history stays. */
  actorUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type PipelineStageEvent = z.infer<typeof pipelineStageEventSchema>;

/** A saved, dynamic directory view: a name plus serialized filter state. */
export const segmentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Serialized DirectoryFilter — parse with `parseSegmentQuery`. */
  query: z.string(),
  createdByUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Segment = z.infer<typeof segmentSchema>;
export const newSegmentSchema = segmentSchema.omit({ id: true, createdAt: true });
export type NewSegment = z.infer<typeof newSegmentSchema>;
