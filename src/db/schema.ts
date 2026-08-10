/**
 * Drizzle schema for D1 (SQLite). This file — and everything under
 * src/db/repos/d1/ — is the ONLY place allowed to import Drizzle. Nothing
 * here should be imported outside src/db/repos/d1/*; the rest of the app
 * talks to the plain types in src/db/entities.ts instead.
 *
 * Run `npm run db:generate` after changing this file to produce a new SQL
 * migration in migrations/.
 */
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, index, unique } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
};

// ---------------------------------------------------------------------------
// Events (spec.md §1)
// ---------------------------------------------------------------------------

export const events = sqliteTable("events", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  /** Conference day boundaries, stored as calendar dates ("YYYY-MM-DD") in
   * the event's own timezone — never as instants, so a schedule never
   * shifts a day when read from another timezone. */
  startDate: text("start_date"),
  endDate: text("end_date"),
  /** IANA zone (e.g. "America/Los_Angeles"); the reference frame for
   * `events.startDate`/`endDate` and every `sessions.day`/time. */
  timezone: text("timezone").notNull().default("UTC"),
  location: text("location"),
  /** Gate on every attendee-facing program surface (decisions.md D-056):
   * until an organizer publishes, /p, /embed and the feeds show a
   * "coming soon" state. New events start unpublished; the public CFP form
   * has its own open/close window and is unaffected by this flag. */
  programPublished: integer("program_published", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Users — doubles as the better-auth "user" table, extended with `role`.
// All roles (admin, reviewer, speaker) authenticate via magic link
// (decisions.md D-007); there is no password column.
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  name: text("name"),
  role: text("role", { enum: ["admin", "reviewer", "speaker"] })
    .notNull()
    .default("speaker"),
  title: text("title"),
  company: text("company"),
  bio: text("bio"),
  headshotUrl: text("headshot_url"),
  /** Speaker-editable profile links (spec.md §6); shown on the public gallery. */
  websiteUrl: text("website_url"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  /** JSON-serialized SpeakerSocials (src/db/entities.ts). */
  socials: text("socials", { mode: "json" }),
  /** better-auth's own avatar field; kept separate from headshotUrl (the
   * domain concept used on speaker profiles/gallery). */
  image: text("image"),
  ...timestamps,
});

// better-auth core tables (magic-link plugin needs `verification`; the
// Drizzle adapter needs `session` and `account`). Named with an `auth_`
// prefix so they don't collide with the domain `sessions` table below
// (scheduled conference talks).
export const authSessions = sqliteTable("auth_sessions", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  ...timestamps,
});

export const authAccounts = sqliteTable("auth_accounts", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const authVerifications = sqliteTable("auth_verifications", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Tracks / Rooms (spec.md §1) and reviewer routing (spec.md §4)
// ---------------------------------------------------------------------------

export const tracks = sqliteTable("tracks", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  ...timestamps,
});

export const rooms = sqliteTable("rooms", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  ...timestamps,
});

/**
 * Reviewer routing (spec.md §4): reviewers own tracks, submissions pick
 * tracks — the intersection is the reviewer's queue. This join *is* the
 * routing engine; there is nothing else.
 */
export const reviewerTracks = sqliteTable(
  "reviewer_tracks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index("reviewer_tracks_track_idx").on(t.trackId),
  ],
);

// ---------------------------------------------------------------------------
// Forms (spec.md §2) — public call-for-speakers forms
// ---------------------------------------------------------------------------

export const forms = sqliteTable("forms", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Public URL segment: /submit/{slug}. Globally unique so the public
   * route doesn't need an event in the path. */
  slug: text("slug").notNull().unique(),
  /** FormType (src/db/entities.ts, decisions.md D-041): "abstract" queues
   * submissions for review, "session" turns them straight into confirmed
   * sessions. Defaulted so every form that predates the switch stays a
   * review-pipeline form. */
  type: text("type").notNull().default("abstract"),
  /** Welcome/explanatory copy shown above the form (spec.md §2). */
  welcomeCopy: text("welcome_copy"),
  /** JSON-serialized FormField[] (src/db/entities.ts, decisions.md D-009). */
  fields: text("fields", { mode: "json" }).notNull(),
  opensAt: integer("opens_at", { mode: "timestamp" }),
  closesAt: integer("closes_at", { mode: "timestamp" }),
  /** Shown after a successful submission (spec.md §2 must-have). */
  confirmationPageContent: text("confirmation_page_content"),
  confirmationEmailSubject: text("confirmation_email_subject"),
  confirmationEmailBody: text("confirmation_email_body"),
  /** Cap on proposals per submitter email; null = unlimited (D-034, D-038). */
  maxSubmissionsPerSpeaker: integer("max_submissions_per_speaker"),
  isPublished: integer("is_published", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Submissions (spec.md §3, §4)
// ---------------------------------------------------------------------------

export const submissions = sqliteTable(
  "submissions",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    /** The abstract. Promoted out of `answers` because every view needs it. */
    description: text("description"),
    /** JSON-serialized answers to the form's custom fields, keyed by field id. */
    answers: text("answers", { mode: "json" }).notNull(),
    /**
     * `submitted` means "received, not yet reviewed" — the spec's
     * `unreviewed` state (spec.md §4). Decisions are recorded here rather
     * than derived from the `reviews` table, which stays optional
     * (enhancement tier).
     */
    status: text("status", {
      enum: ["draft", "submitted", "approved", "maybe", "denied", "withdrawn"],
    })
      .notNull()
      .default("draft"),
    /**
     * Secret in the emailed "finish your draft" link (D-034, D-038). Unique so a
     * token resolves to exactly one proposal; null for submissions that were
     * never saved as a draft.
     */
    resumeToken: text("resume_token").unique(),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    /** Internal note or the feedback attached to an accept/deny email. */
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [
    index("submissions_event_status_idx").on(t.eventId, t.status),
    index("submissions_form_idx").on(t.formId),
  ],
);

/** Many-to-many: a submission picks one or more tracks (spec.md §2, §4). */
export const submissionTracks = sqliteTable(
  "submission_tracks",
  {
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.trackId] }),
    index("submission_tracks_track_idx").on(t.trackId),
  ],
);

/**
 * Co-speakers (spec.md §2): a submission has one `primary` speaker — the
 * submitter, who owns and can edit it — plus any number of `co` speakers.
 * Multiple speakers are supported; two are never required. There is no
 * separate `submitterId` column: the `primary` row is the submitter, so
 * there's one source of truth for "who is on this talk".
 */
export const submissionSpeakers = sqliteTable(
  "submission_speakers",
  {
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["primary", "co"] })
      .notNull()
      .default("co"),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.userId] }),
    index("submission_speakers_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Reviews (spec.md "Useful enhancements": scored reviews / rating fields).
// Decisions live on `submissions`; this table only adds reviewer opinion.
// ---------------------------------------------------------------------------

export const reviews = sqliteTable(
  "reviews",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Nullable: the MVP flow records a comment/recommendation with no score. */
    score: integer("score"),
    comment: text("comment"),
    /** The reviewer's non-binding recommendation, mirroring the decision
     * vocabulary. Nullable for comment-only reviews. */
    recommendation: text("recommendation", {
      enum: ["approve", "maybe", "deny"],
    }),
    ...timestamps,
  },
  (t) => [unique("reviews_submission_reviewer_unq").on(t.submissionId, t.reviewerId)],
);

// ---------------------------------------------------------------------------
// Review rounds (spec.md "Important": multi-round scored evaluations,
// decisions.md D-031). Parallel to `reviews` above, not a replacement: the
// accept/decline flow never reads these tables.
// ---------------------------------------------------------------------------

export const reviewRounds = sqliteTable(
  "review_rounds",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    opensAt: integer("opens_at", { mode: "timestamp" }),
    closesAt: integer("closes_at", { mode: "timestamp" }),
    /** JSON-serialized ScorecardCriterion[] (src/db/entities.ts). Each round
     * carries its own scorecard — that is what makes rounds independent. */
    criteria: text("criteria", { mode: "json" }).notNull(),
    /** Blind review (decisions.md D-049): when set, this round's *reviewer*
     * surfaces withhold every trace of who wrote the proposal. Organizer
     * surfaces are never anonymized, so it is a property of the round rather
     * than of the submission. */
    blindReview: integer("blind_review", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("review_rounds_event_idx").on(t.eventId)],
);

/**
 * Who reviews what, per round. A reviewer's queue *is* this table — there is
 * no round-level track fallback, so a reviewer in round 1 is not
 * automatically in round 2.
 */
export const roundAssignments = sqliteTable(
  "round_assignments",
  {
    id: id(),
    roundId: text("round_id")
      .notNull()
      .references(() => reviewRounds.id, { onDelete: "cascade" }),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "done", "recused"] })
      .notNull()
      .default("pending"),
    recusalReason: text("recusal_reason"),
    ...timestamps,
  },
  (t) => [
    unique("round_assignments_unq").on(t.roundId, t.submissionId, t.reviewerId),
    index("round_assignments_round_idx").on(t.roundId),
    index("round_assignments_reviewer_idx").on(t.reviewerId),
  ],
);

/** One submitted scorecard per assignment; re-submitting replaces it. */
export const roundScores = sqliteTable("round_scores", {
  id: id(),
  assignmentId: text("assignment_id")
    .notNull()
    .unique()
    .references(() => roundAssignments.id, { onDelete: "cascade" }),
  /** JSON object keyed by ScorecardCriterion.id. */
  values: text("values", { mode: "json" }).notNull(),
  submittedAt: integer("submitted_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Sessions (spec.md §5, §9) — confirmed agenda items
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** Null for a session entered directly for a guaranteed speaker, e.g. a
     * sponsor slot with no CFP submission behind it (spec.md §5). */
    submissionId: text("submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),
    trackId: text("track_id").references(() => tracks.id, {
      onDelete: "set null",
    }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    /** Calendar day "YYYY-MM-DD" in the event's timezone. */
    day: text("day"),
    /** Wall-clock "HH:MM" in the event's timezone; null = unscheduled.
     * Storing local wall-clock rather than instants keeps drag-and-drop
     * placement and conflict detection free of timezone arithmetic — the
     * event's `timezone` supplies the offset when an .ics is generated. */
    startTime: text("start_time"),
    endTime: text("end_time"),
    status: text("status", { enum: ["draft", "confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    /**
     * Editorial approval of the session's *content* (decisions.md D-072) —
     * deliberately a separate column from `status` above, which is the
     * scheduling state conflict detection reads. `approved` is the default so
     * a newly converted or directly-entered session behaves exactly as it did
     * before this column existed; an organizer moves it back to draft or
     * in_review on purpose.
     */
    contentStatus: text("content_status", { enum: ["draft", "in_review", "approved"] })
      .notNull()
      .default("approved"),
    ...timestamps,
  },
  (t) => [index("sessions_event_day_idx").on(t.eventId, t.day)],
);

/** A session can have multiple assigned speakers (spec.md §5). */
export const sessionSpeakers = sqliteTable(
  "session_speakers",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.userId] }),
    index("session_speakers_user_idx").on(t.userId),
  ],
);

/**
 * Abstract revision history (decisions.md D-071). Append-only: one row per
 * edit that actually changed a session's abstract, whoever made it. `field`
 * is a column rather than an implied constant so a second tracked field
 * (title, say) needs no table; today only "abstract" is written.
 *
 * `author_user_id` is nullable and set-null on delete — history outlives the
 * account that wrote it, since the point of the panel is what the abstract
 * used to say.
 */
export const sessionRevisions = sqliteTable(
  "session_revisions",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    field: text("field", { enum: ["abstract"] })
      .notNull()
      .default("abstract"),
    /** What the field held before this edit; null when it was empty. */
    priorValue: text("prior_value"),
    newValue: text("new_value"),
    authorUserId: text("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("session_revisions_session_idx").on(t.sessionId)],
);

/**
 * A speaker's record *at one event* (spec.md §5, decisions.md D-051).
 *
 * Two jobs, deliberately in one table. It carries the organizer-only
 * logistics notes ("arrival May 11, aisle seat; dietary: vegetarian"), which
 * are per-event rather than a column on `users` — the same person speaking at
 * two events has two sets of arrangements. And its existence *is* the roster
 * membership for a speaker an organizer entered by hand or imported: before
 * D-051 the roster was derived from session links and task assignments only,
 * so a manually added speaker had nowhere to belong until their first session
 * or task. Roster derivation now unions all three sources
 * (`rosterSpeakerIds` in src/domain/onboarding.ts).
 */
export const eventSpeakers = sqliteTable(
  "event_speakers",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Free text, organizer-only — never shown to the speaker or the public.
     * One field rather than a custom-field builder, per D-051. */
    notes: text("notes"),
    /**
     * The organizer's stored answer to "is this speaker confirmed?"
     * (decisions.md D-068). Deliberately nullable with no default and no
     * backfill: NULL means nobody has said, so the surfaces fall back to the
     * derivation they used before D-068 (confirmed <=> attached to one of
     * this event's sessions). A stored value wins over that derivation
     * everywhere confirmation is shown or filtered.
     */
    confirmationStatus: text("confirmation_status", { enum: ["confirmed", "declined"] }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.userId] }),
    index("event_speakers_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Tasks / Task assignments (speaker onboarding — spec.md §6, §8)
// ---------------------------------------------------------------------------

export const tasks = sqliteTable("tasks", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  instructions: text("instructions"),
  /** The three underlying onboarding jobs (spec.md §6): fill in a form,
   * upload a file, or confirm information that's already on record. */
  type: text("type", { enum: ["form", "file_request", "confirm"] })
    .notNull()
    .default("confirm"),
  /** Required when `type` is "form". */
  formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
  dueAt: integer("due_at", { mode: "timestamp" }),
  /** Assign automatically to every speaker of a newly accepted submission
   * (spec.md §5: acceptance creates the onboarding tasks). */
  autoAssignOnAccept: integer("auto_assign_on_accept", { mode: "boolean" })
    .notNull()
    .default(true),
  ...timestamps,
});

export const taskAssignments = sqliteTable(
  "task_assignments",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    speakerId: text("speaker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "completed"] })
      .notNull()
      .default("pending"),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    /** Answers for a `form` task, keyed by field id. */
    responseJson: text("response_json", { mode: "json" }),
    /** R2 object URL for a `file_request` task. */
    fileUrl: text("file_url"),
    ...timestamps,
  },
  (t) => [
    unique("task_assignments_task_speaker_unq").on(t.taskId, t.speakerId),
    index("task_assignments_speaker_idx").on(t.speakerId),
  ],
);

/**
 * Every file a speaker has sent in (decisions.md D-054), whether it answered
 * an onboarding task or was attached to their profile. Rows are immutable:
 * replacing a file adds a version, it never rewrites one, and the newest row
 * for an assignment is what `task_assignments.file_url` points at.
 *
 * `scope` says which owner column carries the row: `assignment` rows hang off
 * `assignment_id`, `profile` rows off `owner_user_id` (a headshot uploaded
 * from the portal profile or by an organizer on a speaker's behalf). Exactly
 * one of the two is set; both cascade with the thing they belong to.
 *
 * Uploads made before this table existed have no rows, and nothing
 * backfills them — the assignment's own `file_url` stands in as version 1
 * until the next upload arrives, which then writes both rows.
 */
export const fileVersions = sqliteTable(
  "file_versions",
  {
    id: id(),
    /** Which owner column this row uses. Defaults to `assignment`, the only
     * kind that existed before profile files were tracked. */
    scope: text("scope", { enum: ["assignment", "profile"] })
      .notNull()
      .default("assignment"),
    /** Set for `assignment` rows, null for `profile` rows. */
    assignmentId: text("assignment_id").references(() => taskAssignments.id, {
      onDelete: "cascade",
    }),
    /** The speaker a `profile` row belongs to; null for `assignment` rows.
     * Distinct from `uploaded_by`, which can be the organizer who supplied
     * the file on their behalf. */
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Stored R2 object key; null for a file that only ever existed as an
     * absolute URL (an imported deliverable). */
    fileKey: text("file_key"),
    /** What serves this version back — `/files/<key>` for our own uploads. */
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("file_versions_assignment_idx").on(t.assignmentId),
    index("file_versions_owner_idx").on(t.ownerUserId),
  ],
);

/**
 * The comment thread on one deliverable (decisions.md D-054) — speaker and
 * organizer post to the same list, from the portal task card and the Files
 * library respectively. Append-only: no edit or delete, so there is no
 * updated_at and no soft-delete column.
 */
export const fileComments = sqliteTable(
  "file_comments",
  {
    id: id(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => taskAssignments.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("file_comments_assignment_idx").on(t.assignmentId)],
);

// ---------------------------------------------------------------------------
// Email templates / log (spec.md §7)
// ---------------------------------------------------------------------------

export const emailTemplates = sqliteTable("email_templates", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  trigger: text("trigger", {
    enum: ["manual", "on_acceptance", "on_denial", "on_task_assignment", "deadline_reminder"],
  })
    .notNull()
    .default("manual"),
  ...timestamps,
});

/** Every send, for the per-speaker communication log (spec.md §7). */
export const emailLog = sqliteTable(
  "email_log",
  {
    id: id(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    // Drizzle's `enum` is a compile-time union only — the column is plain
    // `text NOT NULL` with no CHECK constraint (migrations/0000), so keeping
    // this list in step with `emailKindSchema` in src/db/entities.ts needs no
    // migration and no DDL change.
    kind: text("kind", {
      enum: [
        "magic_link",
        "submission_confirmation",
        "decision",
        "change_request",
        // Retired in favour of "task_digest" (D-039); still readable history.
        "task_reminder",
        "task_digest",
        "draft_saved",
        "draft_reminder",
        // The manual reviewer completion nudge from a round's assignments
        // page (D-050).
        "round_reminder",
        "calendar_invite",
        // The Team page's "Add a teammate" invitation email (D-062).
        "team_invite",
        // The per-speaker "Send portal invite" from a speaker's record page
        // (D-070).
        "portal_invite",
        "manual",
      ],
    }).notNull(),
    /** What this email was about, so a speaker's log can be reconstructed
     * without a column per relationship. */
    relatedType: text("related_type", {
      enum: ["submission", "session", "task_assignment", "user"],
    }),
    relatedId: text("related_id"),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    error: text("error"),
    sentAt: integer("sent_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("email_log_to_idx").on(t.to)],
);

// ---------------------------------------------------------------------------
// Org-level speaker CRM (spec.md "Org-level speaker CRM", decisions.md D-077)
//
// Everything below is organization-scoped: no `event_id` anywhere. That is the
// point of the area — identity is global by email in `users` (D-051), so a
// person is already a cross-event contact and these tables only add the
// organizer's own material about them (tags, notes, pipeline state, saved
// views). Event-scoped speaker data stays exactly where it was; nothing here
// changes `event_speakers` or its logistics notes.
// ---------------------------------------------------------------------------

/**
 * The registry of contacts an organizer added directly — imported or typed in
 * — who are not (yet) a speaker anywhere.
 *
 * Deliberately *not* the directory itself. The directory is the union of
 * "speaks at >= 1 event" and this table, so a speaker never needs a row here
 * and one is never written for them; that keeps the registry free of the
 * derivation problem D-068 describes, where stored data freezes an answer the
 * rest of the system keeps computing.
 *
 * `user_id` is the primary key: a person is either an explicitly added contact
 * or they aren't, so there is nothing to duplicate.
 */
export const contacts = sqliteTable("contacts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** How the row got here — a manual "Add contact", or the org-level CSV
   * import. Kept so an import can be explained after the fact. */
  source: text("source", { enum: ["manual", "import"] })
    .notNull()
    .default("manual"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Free-form tags on a contact (D-077: tags only, no custom-field builder).
 *
 * Labels are stored already normalized — trimmed, inner whitespace collapsed,
 * lowercased (`normalizeTagLabel` in src/domain/crm.ts) — which is what makes
 * the plain unique constraint below mean "one tag per user per *lowercased*
 * label" without an expression index SQLite would have to recompute.
 */
export const contactTags = sqliteTable(
  "contact_tags",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.label] }),
    index("contact_tags_label_idx").on(t.label),
  ],
);

/**
 * Org-level internal notes on a contact — append-only, newest first when read.
 *
 * Distinct from `event_speakers.notes`, which is one editable field of
 * logistics prose for one person *at one event* (D-051). These are the
 * organization's running commentary on a person across every event, so they
 * are a list rather than a field and they are never rewritten.
 *
 * `author_user_id` is nullable and set-null on delete, following
 * `session_revisions` (D-071): the history outlives the account that wrote it.
 */
export const contactNotes = sqliteTable(
  "contact_notes",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("contact_notes_user_idx").on(t.userId)],
);

/**
 * A contact's card on the sourcing pipeline (D-077).
 *
 * `user_id` is unique: the board is a view of where each *person* stands, so a
 * second card for the same contact would be two contradictory answers. Score
 * and rationale are the optional judgement captured at enrol time.
 */
export const pipelineCards = sqliteTable(
  "pipeline_cards",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    stage: text("stage", {
      enum: ["identified", "contacted", "interested", "confirmed", "declined"],
    })
      .notNull()
      .default("identified"),
    /** Optional 0-100 fit score (the enrol action validates the range);
     * null means nobody scored them. */
    score: integer("score"),
    rationale: text("rationale"),
    ...timestamps,
  },
  (t) => [index("pipeline_cards_stage_idx").on(t.stage)],
);

/**
 * Timestamped stage history for one card. Append-only, like
 * `session_revisions`: `from_stage` is null for the enrol event (the card did
 * not exist before it), and a move that lands on the stage the card is already
 * on writes nothing at all — see `planStageMove` in src/domain/pipeline.ts.
 */
export const pipelineStageEvents = sqliteTable(
  "pipeline_stage_events",
  {
    id: id(),
    cardId: text("card_id")
      .notNull()
      .references(() => pipelineCards.id, { onDelete: "cascade" }),
    /** Null on the enrol event only. */
    fromStage: text("from_stage", {
      enum: ["identified", "contacted", "interested", "confirmed", "declined"],
    }),
    toStage: text("to_stage", {
      enum: ["identified", "contacted", "interested", "confirmed", "declined"],
    }).notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("pipeline_stage_events_card_idx").on(t.cardId)],
);

/**
 * A saved directory view (D-077): a name plus the filter state that produced
 * it, serialized as JSON (`serializeSegmentQuery` in src/domain/segments.ts).
 *
 * Dynamic by construction — the query is re-run on open, so a segment reports
 * its *current* matches rather than a frozen membership list. Stored as a
 * string rather than a JSON column because the app owns the shape and
 * validates it on read; nothing queries inside it.
 */
export const segments = sqliteTable("segments", {
  id: id(),
  name: text("name").notNull(),
  /** Serialized DirectoryFilter; see src/db/repos/contacts.ts. */
  query: text("query").notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
