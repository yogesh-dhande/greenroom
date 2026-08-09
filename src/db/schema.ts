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
