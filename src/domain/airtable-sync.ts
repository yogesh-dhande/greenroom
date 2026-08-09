/**
 * One-way Airtable projection (docs/airtable-sync.md; decisions.md D-002,
 * D-036).
 *
 * D1 stays the single source of truth. This job reads the current state
 * through the storage-agnostic repos and *pushes* a reporting-shaped copy of
 * it into an Airtable base, so the organizer's existing row-triggered
 * automations fire on rows Greenroom created. Nothing is ever read back into
 * the app's own behaviour — see the "why not two-way" section of the design
 * note.
 *
 * Two deliberate limitations, both from the design note:
 *
 * 1. **Stale rows.** A record deleted in D1 keeps its Airtable row: a
 *    projection only ever writes rows it can see, and a delete leaves nothing
 *    behind to project. Reconciling deletions would mean listing every
 *    Airtable record on every run purely to diff it, which costs far more
 *    requests (against a 5 req/s base limit) than the reporting value is
 *    worth. Organizers delete the stale row, or filter on the sync's
 *    `Updated At`.
 * 2. **Schema drift on existing tables.** Missing fields are added via the
 *    create-field endpoint, but an existing field whose *type* differs from
 *    the spec below is left alone (Airtable field conversions are lossy and
 *    not worth automating). Values for such a field still write through
 *    `typecast`, or the batch reports a failure in the summary.
 *
 * Everything here uses plain `fetch` — the `airtable` npm package would add
 * weight to a Worker bundle that is already close to the 3 MiB gzipped cap.
 */
import type { Event, Session, Submission, Task, TaskAssignment, User } from "@/db/entities";
import type { Repos } from "@/db/repos";

// ---------------------------------------------------------------------------
// Schema — this file is the definition of the base's shape
// ---------------------------------------------------------------------------

/** The upsert key on every table: the D1 primary key of the source row. */
export const GREENROOM_ID_FIELD = "greenroom_id";

/** Airtable's batch write cap (create/update/upsert all share it). */
export const AIRTABLE_BATCH_SIZE = 10;

/** ~4 req/s, comfortably under Airtable's documented 5 req/s per base. */
const DEFAULT_REQUEST_SPACING_MS = 250;

/** Airtable's own penalty window after a 429, per D-002's investigation. */
const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;

const AIRTABLE_API_ORIGIN = "https://api.airtable.com";

export const AIRTABLE_TABLES = [
  "Events",
  "Speakers",
  "Submissions",
  "Sessions",
  "Tasks",
] as const;
export type AirtableTableName = (typeof AIRTABLE_TABLES)[number];

/**
 * Only four Airtable field types are used, all of which accept a plain string
 * (or null to clear). Richer types — single select, date, checkbox — would
 * reject or silently coerce values the app considers valid, and a failed
 * write is worse for a reporting base than a text column.
 */
type AirtableFieldType = "singleLineText" | "multilineText" | "email" | "dateTime";

interface FieldSpec {
  name: string;
  type: AirtableFieldType;
}

const DATE_TIME_OPTIONS = {
  timeZone: "utc",
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
} as const;

/**
 * Column set per table, derived from the entity schemas in
 * `src/db/entities.ts` with the design note's two mapping rules applied:
 * foreign keys are resolved to the names an organizer recognises, and fields
 * with no reporting value are dropped rather than dumped as opaque JSON.
 *
 * The **first** entry becomes Airtable's primary field, so each table leads
 * with its human title rather than the id. Adding a column to an entity is a
 * line here plus a line in the matching `project*` function below.
 *
 * Dropped on purpose, and load-bearing: `submissions.answers` and
 * `task_assignments.responseJson` (JSON blobs), `submissions.decidedBy`
 * (internal user id), and `submissions.resumeToken` — that token *is* the
 * authorisation to reopen a draft (D-034), so it must never leave D1.
 */
export const AIRTABLE_TABLE_FIELDS: Record<AirtableTableName, readonly FieldSpec[]> = {
  Events: [
    { name: "Name", type: "singleLineText" },
    { name: GREENROOM_ID_FIELD, type: "singleLineText" },
    { name: "Slug", type: "singleLineText" },
    { name: "Description", type: "multilineText" },
    { name: "Start Date", type: "singleLineText" },
    { name: "End Date", type: "singleLineText" },
    { name: "Timezone", type: "singleLineText" },
    { name: "Location", type: "singleLineText" },
    { name: "Created At", type: "dateTime" },
    { name: "Updated At", type: "dateTime" },
  ],
  Speakers: [
    { name: "Name", type: "singleLineText" },
    { name: GREENROOM_ID_FIELD, type: "singleLineText" },
    { name: "Email", type: "email" },
    { name: "Job Title", type: "singleLineText" },
    { name: "Company", type: "singleLineText" },
    { name: "Bio", type: "multilineText" },
    { name: "Headshot URL", type: "singleLineText" },
    { name: "Website", type: "singleLineText" },
    { name: "LinkedIn", type: "singleLineText" },
    { name: "X / Twitter", type: "singleLineText" },
    { name: "Created At", type: "dateTime" },
    { name: "Updated At", type: "dateTime" },
  ],
  Submissions: [
    { name: "Title", type: "singleLineText" },
    { name: GREENROOM_ID_FIELD, type: "singleLineText" },
    { name: "Event", type: "singleLineText" },
    { name: "Form", type: "singleLineText" },
    { name: "Description", type: "multilineText" },
    { name: "Tracks", type: "singleLineText" },
    { name: "Speakers", type: "singleLineText" },
    { name: "Status", type: "singleLineText" },
    { name: "Decided At", type: "dateTime" },
    { name: "Decision Note", type: "multilineText" },
    { name: "Created At", type: "dateTime" },
    { name: "Updated At", type: "dateTime" },
  ],
  Sessions: [
    { name: "Title", type: "singleLineText" },
    { name: GREENROOM_ID_FIELD, type: "singleLineText" },
    { name: "Event", type: "singleLineText" },
    { name: "Track", type: "singleLineText" },
    { name: "Room", type: "singleLineText" },
    { name: "Day", type: "singleLineText" },
    { name: "Start Time", type: "singleLineText" },
    { name: "End Time", type: "singleLineText" },
    { name: "Status", type: "singleLineText" },
    { name: "Speakers", type: "singleLineText" },
    { name: "Description", type: "multilineText" },
    { name: "Proposal", type: "singleLineText" },
    { name: "Created At", type: "dateTime" },
    { name: "Updated At", type: "dateTime" },
  ],
  Tasks: [
    { name: "Task", type: "singleLineText" },
    { name: GREENROOM_ID_FIELD, type: "singleLineText" },
    { name: "Event", type: "singleLineText" },
    { name: "Type", type: "singleLineText" },
    { name: "Instructions", type: "multilineText" },
    { name: "Due At", type: "dateTime" },
    { name: "Speaker", type: "singleLineText" },
    { name: "Speaker Email", type: "email" },
    { name: "Status", type: "singleLineText" },
    { name: "Completed At", type: "dateTime" },
    { name: "File URL", type: "singleLineText" },
    { name: "Created At", type: "dateTime" },
    { name: "Updated At", type: "dateTime" },
  ],
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Raw credentials as the caller found them in the environment. Kept optional
 * on purpose: deciding *which* one is missing (and saying so in the skip
 * message) belongs here rather than in every caller.
 */
export interface AirtableCredentials {
  /** Personal access token. Worker secret — never logged, never returned. */
  apiKey?: string;
  baseId?: string;
}

export interface AirtableSyncContext {
  repos: Repos;
  airtable?: AirtableCredentials | null;
  /** Sync only this event's rows — what the admin "Sync now" button passes. */
  eventId?: string;
  /** Injectable transport, for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Minimum spacing between Airtable requests; defaults to 250 ms. */
  requestSpacingMs?: number;
  /** How long to wait out a 429 before the single retry; defaults to 30 s. */
  rateLimitRetryMs?: number;
}

export interface AirtableTableCounts {
  created: number;
  updated: number;
  failed: number;
}

export interface AirtableSyncSummary {
  /** True when the run did nothing because Airtable isn't configured. */
  skipped: boolean;
  /** Why it was skipped, naming the missing variable(s). Null otherwise. */
  skippedReason: string | null;
  /** Tables this run had to create; empty on every steady-state run. */
  tablesCreated: AirtableTableName[];
  /** Per-table record counts, keyed by Airtable table name. */
  tables: Record<AirtableTableName, AirtableTableCounts>;
  /** Totals across every table. */
  created: number;
  updated: number;
  failed: number;
  /** Anything that went wrong, already stringified for a log line. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

class AirtableApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AirtableApiError";
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A rate-limit-aware wrapper over `fetch`.
 *
 * The job runs from a cron with no latency budget to protect, so it simply
 * runs slower than the limit — a fixed gap between requests — rather than
 * needing a queue. A 429 still happens if something else is writing to the
 * base, so each request gets exactly one retry after Airtable's 30-second
 * penalty; a second 429 fails the call and is counted in the summary.
 */
class AirtableClient {
  private readonly fetchImpl: typeof fetch;
  private nextRequestAt = 0;

  constructor(
    private readonly apiKey: string,
    readonly baseId: string,
    fetchImpl: typeof fetch,
    private readonly spacingMs: number,
    private readonly rateLimitRetryMs: number,
  ) {
    this.fetchImpl = fetchImpl;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const first = await this.send(method, path, body);
    if (first.status !== 429) return this.parse<T>(first, method, path);

    await sleep(this.rateLimitRetryMs);
    const retry = await this.send(method, path, body);
    return this.parse<T>(retry, method, path);
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const wait = this.nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextRequestAt = Date.now() + this.spacingMs;

    return this.fetchImpl(`${AIRTABLE_API_ORIGIN}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async parse<T>(response: Response, method: string, path: string): Promise<T> {
    if (!response.ok) {
      // The body carries Airtable's own error code (UNKNOWN_FIELD_NAME and
      // friends), which is the only thing that makes a failure diagnosable
      // from `wrangler tail`. It never echoes the token.
      const detail = await response.text().catch(() => "");
      throw new AirtableApiError(
        `${method} ${path} → ${response.status}${detail ? ` ${detail.slice(0, 300)}` : ""}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Metadata API — make the base match the schema above
// ---------------------------------------------------------------------------

interface MetaField {
  id?: string;
  name: string;
  type?: string;
}

interface MetaTable {
  id: string;
  name: string;
  fields?: MetaField[];
}

/** A table as this run will write to it: its id and the fields known to exist. */
interface ResolvedTable {
  id: string;
  fields: Set<string>;
}

function fieldPayload(spec: FieldSpec): Record<string, unknown> {
  return {
    name: spec.name,
    type: spec.type,
    ...(spec.type === "dateTime" ? { options: DATE_TIME_OPTIONS } : {}),
  };
}

async function listTables(client: AirtableClient): Promise<Map<string, MetaTable>> {
  const listed = await client.request<{ tables?: MetaTable[] }>(
    "GET",
    `/v0/meta/bases/${client.baseId}/tables`,
  );
  return new Map((listed.tables ?? []).map((table) => [table.name, table]));
}

/**
 * Brings the base up to the schema above: creates the tables that aren't
 * there and adds fields that are missing from ones that are.
 *
 * Both halves are idempotent because they are driven by what the Metadata
 * API reports, not by a "have I provisioned this?" flag — the same shape as
 * the reminder job's idempotency (docs/airtable-sync.md). A table someone
 * created by hand, or a previous run created, is adopted rather than
 * duplicated; Airtable has no unique constraint on table names, so creating
 * blindly would quietly fork the base into "Events" and "Events 2".
 */
async function ensureTables(
  client: AirtableClient,
  summary: AirtableSyncSummary,
): Promise<Map<AirtableTableName, ResolvedTable>> {
  let existing = await listTables(client);
  const resolved = new Map<AirtableTableName, ResolvedTable>();

  for (const name of AIRTABLE_TABLES) {
    const specs = AIRTABLE_TABLE_FIELDS[name];
    let table = existing.get(name);

    if (!table) {
      try {
        table = await client.request<MetaTable>(
          "POST",
          `/v0/meta/bases/${client.baseId}/tables`,
          { name, fields: specs.map(fieldPayload) },
        );
        summary.tablesCreated.push(name);
      } catch (error) {
        // A concurrent run (cron + "Sync now" pressed at the same moment) may
        // have created it in between; re-read before giving up on the table.
        existing = await listTables(client).catch(() => existing);
        table = existing.get(name);
        if (!table) {
          summary.errors.push(`${name}: couldn't create table — ${describe(error)}`);
          continue;
        }
      }
    }

    const known = new Set((table.fields ?? []).map((field) => field.name));
    for (const spec of specs) {
      if (known.has(spec.name)) continue;
      try {
        await client.request<MetaField>(
          "POST",
          `/v0/meta/bases/${client.baseId}/tables/${table.id}/fields`,
          fieldPayload(spec),
        );
        known.add(spec.name);
      } catch (error) {
        // Not fatal: the upsert below drops values for fields the base
        // doesn't have, so the rest of the row still lands.
        summary.errors.push(`${name}.${spec.name}: couldn't add field — ${describe(error)}`);
      }
    }

    resolved.set(name, { id: table.id, fields: known });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Projection — D1 state, through the repos only
// ---------------------------------------------------------------------------

/** One projected row. `null` clears the cell in Airtable. */
type AirtableFields = Record<string, string | null>;

/** Trimmed text, or null for "nothing to show" — Airtable's empty cell. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A real instant, as the ISO 8601 string Airtable's dateTime fields take. */
function instant(value: Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function joinNames(ids: readonly string[], names: Map<string, string>): string | null {
  const resolved = ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name));
  return resolved.length > 0 ? resolved.join(", ") : null;
}

/** How a person is labelled in a cell an organizer reads. */
function personLabel(user: User): string {
  return user.name?.trim() || user.email;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Everything one event contributes, already resolved to names. */
interface EventBundle {
  event: Event;
  submissions: Submission[];
  sessions: Session[];
  assignments: TaskAssignment[];
  tasksById: Map<string, Task>;
  formNames: Map<string, string>;
  trackNames: Map<string, string>;
  roomNames: Map<string, string>;
  submissionTracks: Map<string, string[]>;
  submissionSpeakers: Map<string, string[]>;
  sessionSpeakers: Map<string, string[]>;
}

async function loadEvent(repos: Repos, event: Event): Promise<EventBundle> {
  const [submissions, forms, tracks, rooms, sessions, tasks, assignments] = await Promise.all([
    repos.submissions.listByEvent(event.id),
    repos.forms.listByEvent(event.id),
    repos.tracks.listByEvent(event.id),
    repos.rooms.listByEvent(event.id),
    repos.sessions.listByEvent(event.id),
    repos.tasks.listByEvent(event.id),
    repos.taskAssignments.listByEvent(event.id),
  ]);

  const submissionIds = submissions.map((row) => row.id);
  const sessionIds = sessions.map((row) => row.id);

  // Batch joins rather than one call per row: at conference scale this is the
  // difference between a handful of queries and several hundred.
  const [trackLinks, speakerLinks, sessionSpeakerLinks] = await Promise.all([
    submissionIds.length > 0
      ? repos.submissions.listTracksBySubmissionIds(submissionIds)
      : Promise.resolve([]),
    submissionIds.length > 0
      ? repos.submissions.listSpeakersBySubmissionIds(submissionIds)
      : Promise.resolve([]),
    sessionIds.length > 0
      ? repos.sessions.listSpeakersBySessionIds(sessionIds)
      : Promise.resolve([]),
  ]);

  const submissionTracks = new Map<string, string[]>();
  for (const link of trackLinks) {
    const list = submissionTracks.get(link.submissionId) ?? [];
    list.push(link.trackId);
    submissionTracks.set(link.submissionId, list);
  }

  const submissionSpeakers = new Map<string, string[]>();
  // Primary first, so the submitter reads as the first name in the cell.
  for (const link of [...speakerLinks].sort((a, b) => (a.role === "primary" ? -1 : b.role === "primary" ? 1 : 0))) {
    const list = submissionSpeakers.get(link.submissionId) ?? [];
    list.push(link.userId);
    submissionSpeakers.set(link.submissionId, list);
  }

  const sessionSpeakers = new Map<string, string[]>();
  for (const link of sessionSpeakerLinks) {
    const list = sessionSpeakers.get(link.sessionId) ?? [];
    list.push(link.userId);
    sessionSpeakers.set(link.sessionId, list);
  }

  return {
    event,
    submissions,
    sessions,
    assignments,
    tasksById: new Map(tasks.map((task) => [task.id, task])),
    formNames: new Map(forms.map((form) => [form.id, form.name])),
    trackNames: new Map(tracks.map((track) => [track.id, track.name])),
    roomNames: new Map(rooms.map((room) => [room.id, room.name])),
    submissionTracks,
    submissionSpeakers,
    sessionSpeakers,
  };
}

/**
 * Turns the loaded bundles into the rows each table gets, resolving every
 * foreign key to the name behind it. Nothing datastore-shaped reaches this
 * point: the repos already handed back plain entities.
 */
function projectRows(
  bundles: EventBundle[],
  users: Map<string, User>,
): Record<AirtableTableName, AirtableFields[]> {
  const userNames = new Map([...users.values()].map((user) => [user.id, personLabel(user)]));

  const rows: Record<AirtableTableName, AirtableFields[]> = {
    Events: [],
    Speakers: [],
    Submissions: [],
    Sessions: [],
    Tasks: [],
  };

  // Dedup by email, matching src/domain/program.ts's `buildGallery`: someone
  // speaking on two sessions is one person, not two rows.
  const speakersByEmail = new Map<string, User>();

  for (const bundle of bundles) {
    const { event } = bundle;
    const eventName = event.name;
    const submissionTitles = new Map(bundle.submissions.map((row) => [row.id, row.title]));

    rows.Events.push({
      Name: eventName,
      [GREENROOM_ID_FIELD]: event.id,
      Slug: event.slug,
      Description: text(event.description),
      "Start Date": text(event.startDate),
      "End Date": text(event.endDate),
      Timezone: event.timezone,
      Location: text(event.location),
      "Created At": instant(event.createdAt),
      "Updated At": instant(event.updatedAt),
    });

    for (const submission of bundle.submissions) {
      const speakerIds = bundle.submissionSpeakers.get(submission.id) ?? [];
      rows.Submissions.push({
        Title: submission.title,
        [GREENROOM_ID_FIELD]: submission.id,
        Event: eventName,
        Form: bundle.formNames.get(submission.formId) ?? null,
        Description: text(submission.description),
        Tracks: joinNames(bundle.submissionTracks.get(submission.id) ?? [], bundle.trackNames),
        Speakers: joinNames(speakerIds, userNames),
        Status: submission.status,
        "Decided At": instant(submission.decidedAt),
        "Decision Note": text(submission.decisionNote),
        "Created At": instant(submission.createdAt),
        "Updated At": instant(submission.updatedAt),
      });
    }

    for (const session of bundle.sessions) {
      rows.Sessions.push({
        Title: session.title,
        [GREENROOM_ID_FIELD]: session.id,
        Event: eventName,
        Track: session.trackId ? (bundle.trackNames.get(session.trackId) ?? null) : null,
        Room: session.roomId ? (bundle.roomNames.get(session.roomId) ?? null) : null,
        Day: text(session.day),
        "Start Time": text(session.startTime),
        "End Time": text(session.endTime),
        Status: session.status,
        Speakers: joinNames(bundle.sessionSpeakers.get(session.id) ?? [], userNames),
        Description: text(session.description),
        Proposal: session.submissionId
          ? (submissionTitles.get(session.submissionId) ?? null)
          : null,
        "Created At": instant(session.createdAt),
        "Updated At": instant(session.updatedAt),
      });
    }

    // One row per assignment (task × speaker) — the table an organizer's
    // "nudge overdue speakers" automation actually watches.
    for (const assignment of bundle.assignments) {
      const task = bundle.tasksById.get(assignment.taskId);
      if (!task) continue;
      const speaker = users.get(assignment.speakerId) ?? null;
      rows.Tasks.push({
        Task: task.title,
        [GREENROOM_ID_FIELD]: assignment.id,
        Event: eventName,
        Type: task.type,
        Instructions: text(task.instructions),
        "Due At": instant(task.dueAt),
        Speaker: speaker ? personLabel(speaker) : null,
        "Speaker Email": speaker?.email ?? null,
        Status: assignment.status,
        "Completed At": instant(assignment.completedAt),
        "File URL": text(assignment.fileUrl),
        "Created At": instant(assignment.createdAt),
        "Updated At": instant(assignment.updatedAt),
      });
    }

    // Membership, not `users.role`, decides who is a speaker here: a session
    // entered directly for a sponsor may be linked to an admin account, and
    // dropping them would leave the Sessions table naming a person the
    // Speakers table doesn't have.
    const linked = [
      ...bundle.submissionSpeakers.values(),
      ...bundle.sessionSpeakers.values(),
    ].flat();
    for (const id of [...linked, ...bundle.assignments.map((row) => row.speakerId)]) {
      const user = users.get(id);
      if (!user) continue;
      const key = user.email.trim().toLowerCase();
      if (!speakersByEmail.has(key)) speakersByEmail.set(key, user);
    }
  }

  for (const speaker of speakersByEmail.values()) {
    rows.Speakers.push({
      Name: personLabel(speaker),
      [GREENROOM_ID_FIELD]: speaker.id,
      Email: speaker.email,
      "Job Title": text(speaker.title),
      Company: text(speaker.company),
      Bio: text(speaker.bio),
      "Headshot URL": text(speaker.headshotUrl),
      Website: text(speaker.websiteUrl),
      LinkedIn: text(speaker.linkedinUrl),
      "X / Twitter": text(speaker.twitterUrl),
      "Created At": instant(speaker.createdAt),
      "Updated At": instant(speaker.updatedAt),
    });
  }

  return rows;
}

async function buildProjection(
  repos: Repos,
  eventId?: string,
): Promise<Record<AirtableTableName, AirtableFields[]>> {
  const allEvents = await repos.events.listAll();
  const events = eventId ? allEvents.filter((event) => event.id === eventId) : allEvents;

  const bundles: EventBundle[] = [];
  for (const event of events) bundles.push(await loadEvent(repos, event));

  const userIds = new Set<string>();
  for (const bundle of bundles) {
    for (const ids of bundle.submissionSpeakers.values()) for (const id of ids) userIds.add(id);
    for (const ids of bundle.sessionSpeakers.values()) for (const id of ids) userIds.add(id);
    for (const assignment of bundle.assignments) userIds.add(assignment.speakerId);
  }

  const users =
    userIds.size > 0 ? await repos.users.listByIds([...userIds]) : ([] as User[]);

  return projectRows(bundles, new Map(users.map((user) => [user.id, user])));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

interface UpsertResponse {
  records?: unknown[];
  createdRecords?: string[];
  updatedRecords?: string[];
}

/**
 * Writes one table's rows with Airtable's batch upsert.
 *
 * `performUpsert.fieldsToMergeOn` is what keeps this idempotent without a
 * find-then-create round trip per row: Airtable matches on `greenroom_id`
 * (the D1 primary key) and decides create-or-update itself, which halves the
 * request count against a 5 req/s base limit.
 */
async function upsertTable(
  client: AirtableClient,
  name: AirtableTableName,
  table: ResolvedTable,
  rows: AirtableFields[],
  summary: AirtableSyncSummary,
): Promise<void> {
  const counts = summary.tables[name];

  // Values for fields the base doesn't have would fail the whole batch with
  // UNKNOWN_FIELD_NAME; dropping them lets the rest of the row land.
  const payloads = rows.map((row) => ({
    fields: Object.fromEntries(
      Object.entries(row).filter(([field]) => table.fields.has(field)),
    ),
  }));

  for (const batch of chunk(payloads, AIRTABLE_BATCH_SIZE)) {
    try {
      const response = await client.request<UpsertResponse>(
        "PATCH",
        `/v0/${client.baseId}/${table.id}`,
        {
          performUpsert: { fieldsToMergeOn: [GREENROOM_ID_FIELD] },
          records: batch,
          // Airtable coerces rather than rejecting a value it would otherwise
          // refuse (e.g. a field a human converted to a select).
          typecast: true,
        },
      );
      counts.created += response.createdRecords?.length ?? 0;
      counts.updated += response.updatedRecords?.length ?? 0;
    } catch (error) {
      counts.failed += batch.length;
      summary.errors.push(`${name}: ${batch.length} record(s) failed — ${describe(error)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function emptySummary(): AirtableSyncSummary {
  return {
    skipped: false,
    skippedReason: null,
    tablesCreated: [],
    tables: {
      Events: { created: 0, updated: 0, failed: 0 },
      Speakers: { created: 0, updated: 0, failed: 0 },
      Submissions: { created: 0, updated: 0, failed: 0 },
      Sessions: { created: 0, updated: 0, failed: 0 },
      Tasks: { created: 0, updated: 0, failed: 0 },
    },
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };
}

/**
 * Projects the current D1 state into the Airtable base (docs/airtable-sync.md,
 * decisions.md D-036). Runs from custom-worker.ts's `scheduled` handler and
 * from the admin Settings "Sync to Airtable now" button — the same function
 * either way, so the button can never drift from what the cron does.
 *
 * **It never throws.** An unconfigured environment, a rate limit, or an
 * Airtable outage all come back as a summary the caller logs; the sync shares
 * a cron tick with the reminder job, and a bonus reporting feature must not be
 * able to take deadline reminders down with it.
 */
export async function runAirtableSync(ctx: AirtableSyncContext): Promise<AirtableSyncSummary> {
  const summary = emptySummary();

  const apiKey = ctx.airtable?.apiKey?.trim();
  const baseId = ctx.airtable?.baseId?.trim();
  const missing = [
    apiKey ? null : "AIRTABLE_API_KEY",
    baseId ? null : "AIRTABLE_BASE_ID",
  ].filter((name): name is string => name !== null);

  if (!apiKey || !baseId) {
    summary.skipped = true;
    summary.skippedReason = `${missing.join(" and ")} not set`;
    return summary;
  }

  const client = new AirtableClient(
    apiKey,
    baseId,
    // Wrap rather than pass `fetch` directly: workerd throws "Illegal
    // invocation" when the global is called with a different `this`.
    ctx.fetchImpl ?? ((input, init) => fetch(input, init)),
    ctx.requestSpacingMs ?? DEFAULT_REQUEST_SPACING_MS,
    ctx.rateLimitRetryMs ?? DEFAULT_RATE_LIMIT_RETRY_MS,
  );

  try {
    // Read D1 first: if the projection can't be built there is nothing worth
    // provisioning tables for, and no Airtable request has been spent yet.
    const rows = await buildProjection(ctx.repos, ctx.eventId);
    const tables = await ensureTables(client, summary);

    for (const name of AIRTABLE_TABLES) {
      const table = tables.get(name);
      const tableRows = rows[name];
      if (tableRows.length === 0) continue;
      if (!table) {
        summary.tables[name].failed += tableRows.length;
        continue;
      }
      await upsertTable(client, name, table, tableRows, summary);
    }
  } catch (error) {
    summary.errors.push(describe(error));
  }

  for (const counts of Object.values(summary.tables)) {
    summary.created += counts.created;
    summary.updated += counts.updated;
    summary.failed += counts.failed;
  }

  return summary;
}

/**
 * One log line describing the run — what `wrangler tail` shows for a cron
 * tick, and what the admin button turns into a toast. A quiet run must say
 * *why* it was quiet, not just that it happened.
 */
export function formatAirtableSummary(summary: AirtableSyncSummary): string {
  if (summary.skipped) return `airtable sync: skipped (${summary.skippedReason})`;

  const perTable = AIRTABLE_TABLES.map((name) => {
    const counts = summary.tables[name];
    return `${name} +${counts.created}/~${counts.updated}${counts.failed > 0 ? `/!${counts.failed}` : ""}`;
  }).join(", ");

  return [
    `airtable sync: ${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`,
    `(${perTable})`,
    summary.tablesCreated.length > 0 ? `tables created: ${summary.tablesCreated.join(", ")}` : null,
    summary.errors.length > 0 ? `errors: ${summary.errors.join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
