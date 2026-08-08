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
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

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
// Events
// ---------------------------------------------------------------------------

export const events = sqliteTable("events", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  timezone: text("timezone").notNull().default("UTC"),
  startDate: integer("start_date", { mode: "timestamp" }),
  endDate: integer("end_date", { mode: "timestamp" }),
  status: text("status", { enum: ["draft", "published", "archived"] })
    .notNull()
    .default("draft"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Users — doubles as the better-auth "user" table, extended with `role`.
// All roles (organizer, reviewer, speaker) authenticate via magic link
// (decisions.md D-007); there is no password column.
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  name: text("name"),
  role: text("role", { enum: ["organizer", "reviewer", "speaker"] })
    .notNull()
    .default("speaker"),
  title: text("title"),
  company: text("company"),
  bio: text("bio"),
  headshotUrl: text("headshot_url"),
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
// Forms (spec.md §1)
// ---------------------------------------------------------------------------

export const forms = sqliteTable("forms", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  /** JSON-serialized FormSchemaDefinition (src/db/entities.ts). */
  schema: text("schema", { mode: "json" }).notNull(),
  status: text("status", { enum: ["draft", "open", "closed"] })
    .notNull()
    .default("draft"),
  opensAt: integer("opens_at", { mode: "timestamp" }),
  closesAt: integer("closes_at", { mode: "timestamp" }),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Submissions (spec.md §1, §4)
// ---------------------------------------------------------------------------

export const submissions = sqliteTable("submissions", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  formId: text("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "restrict" }),
  submitterId: text("submitter_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  /** Set by form-answer routing rules (decisions.md D-009). */
  category: text("category"),
  status: text("status", {
    enum: [
      "draft",
      "submitted",
      "under_review",
      "accepted",
      "rejected",
      "waitlisted",
    ],
  })
    .notNull()
    .default("draft"),
  /** JSON-serialized answers, keyed by the form's field keys. */
  answers: text("answers", { mode: "json" }).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Reviews (spec.md §4)
// ---------------------------------------------------------------------------

export const reviews = sqliteTable("reviews", {
  id: id(),
  submissionId: text("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  round: integer("round").notNull().default(1),
  /** JSON-serialized scores, keyed by scoring-criteria id. */
  scores: text("scores", { mode: "json" }).notNull(),
  comments: text("comments"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Tracks / Rooms / Sessions (spec.md §5)
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

export const sessions = sqliteTable("sessions", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  submissionId: text("submission_id").references(() => submissions.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description"),
  startTime: integer("start_time", { mode: "timestamp" }),
  endTime: integer("end_time", { mode: "timestamp" }),
  roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
  trackId: text("track_id").references(() => tracks.id, {
    onDelete: "set null",
  }),
  status: text("status", { enum: ["scheduled", "cancelled"] })
    .notNull()
    .default("scheduled"),
  ...timestamps,
});

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
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Tasks / Task assignments (onboarding — spec.md §2, §6)
// ---------------------------------------------------------------------------

export const tasks = sqliteTable("tasks", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
  dueDate: integer("due_date", { mode: "timestamp" }),
  ...timestamps,
});

export const taskAssignments = sqliteTable("task_assignments", {
  id: id(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "in_progress", "complete"] })
    .notNull()
    .default("pending"),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Email templates / log (spec.md §3)
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
    enum: ["manual", "on_acceptance", "on_task_assignment", "deadline_reminder"],
  })
    .notNull()
    .default("manual"),
  ...timestamps,
});

export const emailLog = sqliteTable("email_log", {
  id: id(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => emailTemplates.id, {
    onDelete: "set null",
  }),
  subject: text("subject").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
