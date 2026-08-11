import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Event,
  EventSpeaker,
  Form,
  Room,
  Session,
  SessionSpeaker,
  Submission,
  SubmissionSpeaker,
  SubmissionTrack,
  Task,
  TaskAssignment,
  Track,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  AIRTABLE_BATCH_SIZE,
  AIRTABLE_TABLE_FIELDS,
  AIRTABLE_TABLES,
  GREENROOM_ID_FIELD,
  runAirtableSync,
  type AirtableTableName,
} from "@/domain/airtable-sync";

const BASE_ID = "appTestBase";
const NOW = new Date("2026-05-01T17:00:00.000Z");

// ---------------------------------------------------------------------------
// Entity fixtures
// ---------------------------------------------------------------------------

function timestamps() {
  return { createdAt: NOW, updatedAt: NOW };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-1",
    name: "AI Engineer Summit 2026",
    slug: "aie-2026",
    description: "Two days of agents in production",
    startDate: "2026-06-16",
    endDate: "2026-06-18",
    timezone: "America/Los_Angeles",
    location: "Moscone West",
    programPublished: true,
    ...timestamps(),
    ...overrides,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "priya@example.test",
    emailVerified: true,
    name: "Priya Raman",
    role: "speaker",
    title: "Staff Engineer",
    company: "Northwind",
    bio: "Builds agents.",
    headshotUrl: "/api/files/headshots/priya.jpg",
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
    ...timestamps(),
    ...overrides,
  };
}

function form(overrides: Partial<Form> = {}): Form {
  return {
    id: "form-1",
    eventId: "event-1",
    name: "Call for Speakers",
    slug: "aie-2026-cfp",
    type: "abstract",
    welcomeCopy: null,
    fields: [],
    opensAt: null,
    closesAt: null,
    confirmationPageContent: null,
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    isPublished: true,
    ...timestamps(),
    ...overrides,
  };
}

function track(overrides: Partial<Track> = {}): Track {
  return { id: "track-1", eventId: "event-1", name: "AI Engineering", color: null, ...timestamps(), ...overrides };
}

function room(overrides: Partial<Room> = {}): Room {
  return { id: "room-1", eventId: "event-1", name: "Golden Gate Hall", capacity: 400, ...timestamps(), ...overrides };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "submission-1",
    eventId: "event-1",
    formId: "form-1",
    title: "Shipping agents that don't page you at 3am",
    description: "A talk about guardrails.",
    // Internal-only, all three: a JSON blob, a reviewer id, and the secret
    // that reopens a draft. None may ever reach Airtable.
    answers: { budget: "$0", secretNote: "internal" },
    status: "approved",
    resumeToken: "resume-token-do-not-leak",
    decidedBy: "user-admin",
    decidedAt: NOW,
    decisionNote: "Strong fit",
    ...timestamps(),
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    eventId: "event-1",
    title: "Shipping agents that don't page you at 3am",
    description: null,
    submissionId: "submission-1",
    trackId: "track-1",
    roomId: "room-1",
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:30",
    status: "confirmed",
    contentStatus: "approved",
    ...timestamps(),
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    eventId: "event-1",
    title: "Upload your headshot",
    instructions: "PNG or JPG, 1000px minimum.",
    type: "file_request",
    formId: null,
    dueAt: NOW,
    autoAssignOnAccept: true,
    ...timestamps(),
    ...overrides,
  };
}

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: "assignment-1",
    taskId: "task-1",
    speakerId: "user-1",
    status: "pending",
    completedAt: null,
    responseJson: { internalOnly: "yes" },
    fileUrl: null,
    ...timestamps(),
    ...overrides,
  };
}

/** A roster row (D-051) — the only link a manually added/CSV-imported
 * speaker has before they get a submission, session, or task. */
function eventSpeaker(overrides: Partial<EventSpeaker> = {}): EventSpeaker {
  return {
    eventId: "event-1",
    userId: "user-1",
    notes: null,
    confirmationStatus: null,
    ...timestamps(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A repository double
// ---------------------------------------------------------------------------

interface Seed {
  events?: Event[];
  forms?: Form[];
  tracks?: Track[];
  rooms?: Room[];
  submissions?: Submission[];
  submissionTracks?: SubmissionTrack[];
  submissionSpeakers?: SubmissionSpeaker[];
  sessions?: Session[];
  sessionSpeakers?: SessionSpeaker[];
  tasks?: Task[];
  assignments?: TaskAssignment[];
  users?: User[];
  eventSpeakers?: EventSpeaker[];
}

/**
 * Just enough of the repository layer for `runAirtableSync`, backed by arrays.
 * The job's whole contract is "what shape do these rows take in Airtable", so
 * running it against in-memory entities exercises the real projection rather
 * than a mock of it.
 */
function fakeRepos(seed: Seed): Repos {
  const byEvent = <T extends { eventId: string }>(rows: T[] | undefined) =>
    async (eventId: string) => (rows ?? []).filter((row) => row.eventId === eventId);

  const repos = {
    events: { listAll: async () => seed.events ?? [] },
    forms: { listByEvent: byEvent(seed.forms) },
    tracks: { listByEvent: byEvent(seed.tracks) },
    rooms: { listByEvent: byEvent(seed.rooms) },
    submissions: {
      listByEvent: byEvent(seed.submissions),
      listTracksBySubmissionIds: async (ids: string[]) =>
        (seed.submissionTracks ?? []).filter((row) => ids.includes(row.submissionId)),
      listSpeakersBySubmissionIds: async (ids: string[]) =>
        (seed.submissionSpeakers ?? []).filter((row) => ids.includes(row.submissionId)),
    },
    sessions: {
      listByEvent: byEvent(seed.sessions),
      listSpeakersBySessionIds: async (ids: string[]) =>
        (seed.sessionSpeakers ?? []).filter((row) => ids.includes(row.sessionId)),
    },
    tasks: { listByEvent: byEvent(seed.tasks) },
    taskAssignments: {
      listByEvent: async (eventId: string) => {
        const taskIds = new Set(
          (seed.tasks ?? []).filter((row) => row.eventId === eventId).map((row) => row.id),
        );
        return (seed.assignments ?? []).filter((row) => taskIds.has(row.taskId));
      },
    },
    users: {
      listByIds: async (ids: string[]) => (seed.users ?? []).filter((row) => ids.includes(row.id)),
    },
    eventSpeakers: { listByEvent: byEvent(seed.eventSpeakers) },
  };

  return repos as unknown as Repos;
}

/** One event with a submission, a session, a task assignment, and a speaker. */
function fullSeed(): Seed {
  return {
    events: [event()],
    forms: [form()],
    tracks: [track()],
    rooms: [room()],
    submissions: [submission()],
    submissionTracks: [{ submissionId: "submission-1", trackId: "track-1" }],
    submissionSpeakers: [{ submissionId: "submission-1", userId: "user-1", role: "primary" }],
    sessions: [session()],
    sessionSpeakers: [{ sessionId: "session-1", userId: "user-1" }],
    tasks: [task()],
    assignments: [assignment()],
    users: [user()],
  };
}

// ---------------------------------------------------------------------------
// An Airtable double
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  path: string;
  query: Record<string, string[]>;
  body: Record<string, unknown> | null;
  at: number;
}

interface FakeAirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

function allFieldsOf(table: AirtableTableName) {
  return AIRTABLE_TABLE_FIELDS[table].map((field) => ({ name: field.name, type: field.type }));
}

/**
 * Stands in for the Airtable REST API: metadata and data records both persist
 * across calls, so a second sync exercises Airtable's real ID-upsert behavior
 * instead of pretending every PATCH created another row.
 * `rateLimit` makes the next N matching upserts answer 429 so the retry path
 * is exercised against the same code every other test runs.
 */
function fakeAirtable(options: {
  existingTables?: AirtableTableName[];
  /** Field names each existing table already has; defaults to the full set. */
  existingFields?: Partial<Record<AirtableTableName, string[]>>;
  /** Reject every create-field call, as a base on a plan that forbids it would. */
  refuseFieldCreates?: boolean;
  rateLimit?: number;
  existingRecords?: Partial<
    Record<AirtableTableName, Array<{ id?: string; fields: Record<string, unknown> }>>
  >;
  /** Force short data pages so pagination is observable in focused tests. */
  pageSize?: number;
} = {}) {
  const tables = new Map<string, { id: string; name: string; fields: { name: string }[] }>();
  const records = new Map<AirtableTableName, FakeAirtableRecord[]>();
  let nextRecordId = 1;
  for (const name of options.existingTables ?? []) {
    const only = options.existingFields?.[name];
    tables.set(name, {
      id: `tbl${name}`,
      name,
      fields: only ? only.map((field) => ({ name: field })) : allFieldsOf(name),
    });
    records.set(
      name,
      (options.existingRecords?.[name] ?? []).map((record) => ({
        id: record.id ?? `recSeed${nextRecordId++}`,
        fields: { ...record.fields },
      })),
    );
  }

  const calls: Call[] = [];
  let remainingRateLimits = options.rateLimit ?? 0;

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

  const fetchImpl = (async (input: string, init?: { method?: string; body?: string }) => {
    const url = new URL(input);
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const query = Object.fromEntries(
      [...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key)]),
    );
    calls.push({ method, path, query, body, at: Date.now() });

    if (method === "GET" && path === `/v0/meta/bases/${BASE_ID}/tables`) {
      return json({ tables: [...tables.values()] });
    }

    if (method === "POST" && path === `/v0/meta/bases/${BASE_ID}/tables`) {
      const name = String(body?.name);
      const fields = (body?.fields as { name: string }[]) ?? [];
      const created = { id: `tbl${name}`, name, fields };
      tables.set(name, created);
      records.set(name as AirtableTableName, []);
      return json(created);
    }

    const fieldMatch = path.match(new RegExp(`^/v0/meta/bases/${BASE_ID}/tables/(.+)/fields$`));
    if (method === "POST" && fieldMatch) {
      if (options.refuseFieldCreates) {
        return json({ error: { type: "INVALID_PERMISSIONS" } }, 403);
      }
      const table = [...tables.values()].find((row) => row.id === fieldMatch[1]);
      const field = { name: String(body?.name) };
      table?.fields.push(field);
      return json(field);
    }

    const dataMatch = path.match(new RegExp(`^/v0/${BASE_ID}/([^/]+)$`));
    const table = dataMatch
      ? ([...tables.values()].find((row) => row.id === dataMatch[1]) ?? null)
      : null;

    if (method === "GET" && table) {
      const tableRecords = records.get(table.name as AirtableTableName) ?? [];
      const start = Number(url.searchParams.get("offset") ?? "0");
      const requestedPageSize = Number(url.searchParams.get("pageSize") ?? "100");
      const pageSize = Math.min(options.pageSize ?? requestedPageSize, requestedPageSize);
      const page = tableRecords.slice(start, start + pageSize);
      const selectedFields = url.searchParams.getAll("fields[]");
      return json({
        records: page.map((record) => ({
          id: record.id,
          fields:
            selectedFields.length === 0
              ? { ...record.fields }
              : Object.fromEntries(
                  Object.entries(record.fields).filter(([field]) => selectedFields.includes(field)),
                ),
        })),
        ...(start + pageSize < tableRecords.length ? { offset: String(start + pageSize) } : {}),
      });
    }

    if (method === "PATCH" && table) {
      if (remainingRateLimits > 0) {
        remainingRateLimits -= 1;
        return json({ error: "RATE_LIMIT_REACHED" }, 429);
      }
      const payloads =
        (body?.records as Array<{ fields: Record<string, unknown> }> | undefined) ?? [];
      const tableRecords = records.get(table.name as AirtableTableName) ?? [];
      const createdRecords: string[] = [];
      const updatedRecords: string[] = [];
      const responseRecords: FakeAirtableRecord[] = [];

      for (const payload of payloads) {
        const sourceId = payload.fields[GREENROOM_ID_FIELD];
        const existing = tableRecords.find(
          (record) => record.fields[GREENROOM_ID_FIELD] === sourceId,
        );
        if (existing) {
          existing.fields = { ...existing.fields, ...payload.fields };
          updatedRecords.push(existing.id);
          responseRecords.push({ id: existing.id, fields: { ...existing.fields } });
        } else {
          const created = { id: `recGenerated${nextRecordId++}`, fields: { ...payload.fields } };
          tableRecords.push(created);
          createdRecords.push(created.id);
          responseRecords.push({ id: created.id, fields: { ...created.fields } });
        }
      }
      records.set(table.name as AirtableTableName, tableRecords);
      return json({
        records: responseRecords,
        createdRecords,
        updatedRecords,
      });
    }

    if (method === "DELETE" && table) {
      const ids = new Set(url.searchParams.getAll("records[]"));
      const tableName = table.name as AirtableTableName;
      const tableRecords = records.get(tableName) ?? [];
      const deleted = tableRecords
        .filter((record) => ids.has(record.id))
        .map((record) => ({ id: record.id, deleted: true }));
      records.set(
        tableName,
        tableRecords.filter((record) => !ids.has(record.id)),
      );
      return json({ records: deleted });
    }

    return json({ error: { type: "NOT_FOUND" } }, 404);
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    upserts: () => calls.filter((call) => call.method === "PATCH"),
    tableCreates: () =>
      calls.filter((call) => call.method === "POST" && call.path.endsWith("/tables")),
    fieldCreates: () =>
      calls.filter((call) => call.method === "POST" && call.path.endsWith("/fields")),
    deletes: () => calls.filter((call) => call.method === "DELETE"),
    records: (table: AirtableTableName) =>
      (records.get(table) ?? []).map((record) => ({
        id: record.id,
        fields: { ...record.fields },
      })),
  };
}

function context(
  seed: Seed,
  airtable: ReturnType<typeof fakeAirtable>,
  overrides: { appUrl?: string; eventId?: string } = {},
) {
  return {
    repos: fakeRepos(seed),
    airtable: { apiKey: "pat-test", baseId: BASE_ID },
    fetchImpl: airtable.fetchImpl,
    // The 250 ms production spacing is a rate-limit courtesy, not behaviour
    // under test; the 429 path below drives the timer instead.
    requestSpacingMs: 0,
    ...overrides,
  };
}

/** Every field object across every upsert this run performed. */
function upsertedFields(airtable: ReturnType<typeof fakeAirtable>) {
  return airtable
    .upserts()
    .flatMap((call) => (call.body?.records as { fields: Record<string, unknown> }[]) ?? [])
    .map((record) => record.fields);
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Unconfigured
// ---------------------------------------------------------------------------

describe("runAirtableSync — configuration", () => {
  it("skips without touching the network when neither variable is set", async () => {
    const airtable = fakeAirtable();
    const summary = await runAirtableSync({
      repos: fakeRepos(fullSeed()),
      airtable: null,
      fetchImpl: airtable.fetchImpl,
    });

    expect(summary.skipped).toBe(true);
    expect(summary.skippedReason).toBe("AIRTABLE_API_KEY and AIRTABLE_BASE_ID not set");
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(0);
    expect(airtable.calls).toHaveLength(0);
  });

  it("names the one variable that is missing", async () => {
    const airtable = fakeAirtable();
    const summary = await runAirtableSync({
      repos: fakeRepos(fullSeed()),
      airtable: { apiKey: "pat-test", baseId: "   " },
      fetchImpl: airtable.fetchImpl,
    });

    expect(summary.skippedReason).toBe("AIRTABLE_BASE_ID not set");
    expect(airtable.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Schema provisioning
// ---------------------------------------------------------------------------

describe("runAirtableSync — table provisioning", () => {
  it("creates only the tables the base is missing", async () => {
    const airtable = fakeAirtable({ existingTables: ["Events", "Speakers"] });
    const summary = await runAirtableSync(context(fullSeed(), airtable));

    expect(summary.tablesCreated).toEqual(["Submissions", "Sessions", "Tasks"]);
    expect(airtable.tableCreates().map((call) => call.body?.name)).toEqual([
      "Submissions",
      "Sessions",
      "Tasks",
    ]);
    // A pre-existing table is adopted, never duplicated.
    expect(airtable.tableCreates().map((call) => call.body?.name)).not.toContain("Events");
    expect(summary.errors).toEqual([]);
  });

  it("creates nothing when every table is already provisioned", async () => {
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    const summary = await runAirtableSync(context(fullSeed(), airtable));

    expect(summary.tablesCreated).toEqual([]);
    expect(airtable.tableCreates()).toHaveLength(0);
    expect(airtable.fieldCreates()).toHaveLength(0);
  });

  it("gives every new table a greenroom_id field to upsert against", async () => {
    const airtable = fakeAirtable();
    await runAirtableSync(context(fullSeed(), airtable));

    for (const call of airtable.tableCreates()) {
      const fields = (call.body?.fields as { name: string }[]) ?? [];
      expect(fields.map((field) => field.name)).toContain(GREENROOM_ID_FIELD);
    }
  });

  it("backfills fields missing from a table that already exists", async () => {
    const airtable = fakeAirtable({
      existingTables: [...AIRTABLE_TABLES],
      existingFields: { Submissions: ["Title", GREENROOM_ID_FIELD] },
    });
    await runAirtableSync(context(fullSeed(), airtable));

    const created = airtable.fieldCreates().map((call) => call.body?.name);
    expect(created).toContain("Decision Note");
    expect(created).not.toContain("Title");
    // Only the one under-provisioned table needed work.
    expect(airtable.fieldCreates().every((call) => call.path.includes("tblSubmissions"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

describe("runAirtableSync — projection", () => {
  it("resolves foreign keys to the names an organizer recognises", async () => {
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(fullSeed(), airtable));

    const submissionRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "submission-1",
    );
    expect(submissionRow).toMatchObject({
      Title: "Shipping agents that don't page you at 3am",
      Event: "AI Engineer Summit 2026",
      Form: "Call for Speakers",
      Tracks: "AI Engineering",
      Speakers: "Priya Raman",
      Status: "approved",
      "Decision Note": "Strong fit",
    });

    const sessionRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "session-1",
    );
    expect(sessionRow).toMatchObject({
      Track: "AI Engineering",
      Room: "Golden Gate Hall",
      Day: "2026-06-16",
      "Start Time": "10:00",
      Speakers: "Priya Raman",
    });

    const taskRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "assignment-1",
    );
    expect(taskRow).toMatchObject({
      Task: "Upload your headshot",
      Event: "AI Engineer Summit 2026",
      Speaker: "Priya Raman",
      "Speaker Email": "priya@example.test",
      Status: "pending",
    });
  });

  it("never projects a resume token, answers blob, or internal id", async () => {
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(fullSeed(), airtable));

    for (const fields of upsertedFields(airtable)) {
      expect(Object.keys(fields)).not.toContain("resumeToken");
      expect(Object.keys(fields)).not.toContain("answers");
      expect(Object.keys(fields)).not.toContain("decidedBy");
      expect(Object.keys(fields)).not.toContain("responseJson");
    }

    // Belt and braces: the token must not appear as a *value* either, under
    // any column name — a projection bug that leaked it would be a real one.
    const serialized = JSON.stringify(airtable.calls);
    expect(serialized).not.toContain("resume-token-do-not-leak");
    expect(serialized).not.toContain("secretNote");
    expect(serialized).not.toContain("user-admin");
  });

  it("keeps one Speakers row per email across submissions and sessions", async () => {
    const seed = fullSeed();
    seed.submissions = [submission(), submission({ id: "submission-2", title: "Second talk" })];
    seed.submissionSpeakers = [
      { submissionId: "submission-1", userId: "user-1", role: "primary" },
      { submissionId: "submission-2", userId: "user-1", role: "primary" },
    ];

    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    const summary = await runAirtableSync(context(seed, airtable));

    const speakerRows = airtable
      .upserts()
      .filter((call) => call.path.endsWith("tblSpeakers"))
      .flatMap((call) => (call.body?.records as { fields: Record<string, unknown> }[]) ?? []);
    expect(speakerRows).toHaveLength(1);
    expect(speakerRows[0].fields).toMatchObject({ Name: "Priya Raman", Email: "priya@example.test" });
    expect(summary.tables.Submissions.created).toBe(2);
  });

  it("drops values for fields the base doesn't have rather than failing the batch", async () => {
    // A base that refuses new fields: only the columns already on the table
    // are written, and the row still lands instead of the whole batch dying
    // on UNKNOWN_FIELD_NAME.
    const airtable = fakeAirtable({
      existingTables: [...AIRTABLE_TABLES],
      existingFields: { Events: ["Name", GREENROOM_ID_FIELD] },
      refuseFieldCreates: true,
    });
    const summary = await runAirtableSync(context({ events: [event()] }, airtable));

    expect(upsertedFields(airtable)).toEqual([
      { Name: "AI Engineer Summit 2026", [GREENROOM_ID_FIELD]: "event-1" },
    ]);
    expect(summary.tables.Events).toEqual({ created: 1, updated: 0, deleted: 0, failed: 0 });
    expect(summary.errors.join(" ")).toContain("couldn't add field");
  });

  it("syncs a roster-only speaker who has no submission, session, or task assignment", async () => {
    // A manually added or CSV-imported speaker (D-051): their only link to
    // the event is the `event_speakers` roster row, not any of the other
    // three sources the Speakers table dedupes from.
    const seed: Seed = {
      events: [event()],
      users: [user({ id: "user-2", email: "jordan@example.test", name: "Jordan Lee" })],
      eventSpeakers: [eventSpeaker({ eventId: "event-1", userId: "user-2" })],
    };

    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(seed, airtable));

    const speakerRows = airtable
      .upserts()
      .filter((call) => call.path.endsWith("tblSpeakers"))
      .flatMap((call) => (call.body?.records as { fields: Record<string, unknown> }[]) ?? []);
    expect(speakerRows).toHaveLength(1);
    expect(speakerRows[0].fields).toMatchObject({
      Name: "Jordan Lee",
      Email: "jordan@example.test",
      [GREENROOM_ID_FIELD]: "user-2",
    });
  });

  it("leaves a relative file URL alone when no app origin is configured", async () => {
    const seed = fullSeed();
    seed.assignments = [assignment({ fileUrl: "/files/uploads/slides.pdf" })];
    seed.users = [user({ headshotUrl: "/files/headshots/priya.jpg" })];

    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(seed, airtable));

    const taskRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "assignment-1",
    );
    expect(taskRow?.["File URL"]).toBe("/files/uploads/slides.pdf");
    const speakerRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "user-1",
    );
    expect(speakerRow?.["Headshot URL"]).toBe("/files/headshots/priya.jpg");
  });

  it("resolves a relative file URL against the configured app origin", async () => {
    const seed = fullSeed();
    seed.assignments = [assignment({ fileUrl: "/files/uploads/slides.pdf" })];
    seed.users = [user({ headshotUrl: "/files/headshots/priya.jpg" })];

    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(seed, airtable, { appUrl: "https://greenroom.example.test/" }));

    const taskRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "assignment-1",
    );
    expect(taskRow?.["File URL"]).toBe("https://greenroom.example.test/files/uploads/slides.pdf");
    const speakerRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "user-1",
    );
    expect(speakerRow?.["Headshot URL"]).toBe(
      "https://greenroom.example.test/files/headshots/priya.jpg",
    );
  });

  it("leaves an already-absolute headshot URL untouched even with an app origin configured", async () => {
    const seed = fullSeed();
    seed.users = [user({ headshotUrl: "https://cdn.example.test/priya.jpg" })];

    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(seed, airtable, { appUrl: "https://greenroom.example.test" }));

    const speakerRow = upsertedFields(airtable).find(
      (fields) => fields[GREENROOM_ID_FIELD] === "user-1",
    );
    expect(speakerRow?.["Headshot URL"]).toBe("https://cdn.example.test/priya.jpg");
  });
});

// ---------------------------------------------------------------------------
// Deletion reconciliation
// ---------------------------------------------------------------------------

describe("runAirtableSync — deletion reconciliation", () => {
  it("is idempotent across repeated full syncs", async () => {
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });

    const first = await runAirtableSync(context(fullSeed(), airtable));
    const second = await runAirtableSync(context(fullSeed(), airtable));

    expect(first.created).toBe(5);
    expect(first.updated).toBe(0);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(5);
    expect(second.deleted).toBe(0);
    for (const table of AIRTABLE_TABLES) {
      expect(airtable.records(table)).toHaveLength(1);
    }
  });

  it("deletes an Airtable-managed row after its source record is deleted", async () => {
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    await runAirtableSync(context(fullSeed(), airtable));

    const withoutSession = fullSeed();
    withoutSession.sessions = [];
    withoutSession.sessionSpeakers = [];
    const summary = await runAirtableSync(context(withoutSession, airtable));

    expect(summary.tables.Sessions.deleted).toBe(1);
    expect(summary.deleted).toBe(1);
    expect(airtable.records("Sessions")).toEqual([]);
  });

  it("creates a fresh Airtable row when a deleted source id is recreated", async () => {
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    const populated: Seed = {
      events: [event()],
      forms: [form()],
      submissions: [submission()],
    };
    await runAirtableSync(context(populated, airtable));
    const originalRecordId = airtable.records("Submissions")[0].id;

    const deletion = await runAirtableSync(
      context({ events: [event()], forms: [form()], submissions: [] }, airtable),
    );
    expect(deletion.tables.Submissions.deleted).toBe(1);

    const recreation = await runAirtableSync(context(populated, airtable));
    expect(recreation.tables.Submissions.created).toBe(1);
    expect(airtable.records("Submissions")).toHaveLength(1);
    expect(airtable.records("Submissions")[0].id).not.toBe(originalRecordId);
    expect(airtable.records("Submissions")[0].fields[GREENROOM_ID_FIELD]).toBe("submission-1");
  });

  it("preserves human Airtable rows with a missing or empty Greenroom id while paginating", async () => {
    const airtable = fakeAirtable({
      existingTables: [...AIRTABLE_TABLES],
      pageSize: 2,
      existingRecords: {
        Events: [
          { id: "recManualMissing", fields: { Name: "Human row" } },
          { id: "recManualEmpty", fields: { Name: "Blank key", [GREENROOM_ID_FIELD]: "" } },
          { id: "recManualSpace", fields: { Name: "Space key", [GREENROOM_ID_FIELD]: "   " } },
          { id: "recStaleOne", fields: { Name: "Old event", [GREENROOM_ID_FIELD]: "event-old-1" } },
          { id: "recStaleTwo", fields: { Name: "Older event", [GREENROOM_ID_FIELD]: "event-old-2" } },
        ],
      },
    });

    const summary = await runAirtableSync(context({ events: [event()] }, airtable));

    expect(summary.tables.Events.deleted).toBe(2);
    expect(airtable.records("Events").map((record) => record.id)).toEqual([
      "recManualMissing",
      "recManualEmpty",
      "recManualSpace",
      expect.stringMatching(/^recGenerated/),
    ]);
    const listCalls = airtable.calls.filter(
      (call) => call.method === "GET" && call.path === `/v0/${BASE_ID}/tblEvents`,
    );
    expect(listCalls).toHaveLength(3);
    expect(listCalls.every((call) => call.query["fields[]"]?.[0] === GREENROOM_ID_FIELD)).toBe(true);
  });

  it("never reconciles deletions during an event-scoped Settings sync", async () => {
    const airtable = fakeAirtable({
      existingTables: [...AIRTABLE_TABLES],
      existingRecords: {
        Sessions: [
          {
            id: "recOtherEventSession",
            fields: { Title: "Other event talk", [GREENROOM_ID_FIELD]: "session-other-event" },
          },
        ],
      },
    });

    const summary = await runAirtableSync(
      context({ events: [event()] }, airtable, { eventId: "event-1" }),
    );

    expect(summary.deleted).toBe(0);
    expect(airtable.deletes()).toHaveLength(0);
    expect(airtable.records("Sessions")).toHaveLength(1);
    expect(
      airtable.calls.some(
        (call) => call.method === "GET" && call.path === `/v0/${BASE_ID}/tblSessions`,
      ),
    ).toBe(false);
  });

  it("deletes stale records in Airtable batches of at most 10", async () => {
    const airtable = fakeAirtable({
      existingTables: [...AIRTABLE_TABLES],
      existingRecords: {
        Events: Array.from({ length: 23 }, (_, index) => ({
          id: `recStale${index}`,
          fields: { Name: `Old event ${index}`, [GREENROOM_ID_FIELD]: `event-old-${index}` },
        })),
      },
    });

    const summary = await runAirtableSync(context({}, airtable));

    expect(summary.tables.Events.deleted).toBe(23);
    expect(airtable.deletes().map((call) => call.query["records[]"].length)).toEqual([10, 10, 3]);
  });
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

describe("runAirtableSync — batching", () => {
  it("upserts at most 10 records per request, merging on greenroom_id", async () => {
    const seed: Seed = {
      events: [event()],
      forms: [form()],
      submissions: Array.from({ length: 23 }, (_, index) =>
        submission({ id: `submission-${index}`, title: `Talk ${index}` }),
      ),
    };

    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES] });
    const summary = await runAirtableSync(context(seed, airtable));

    const submissionUpserts = airtable
      .upserts()
      .filter((call) => call.path === `/v0/${BASE_ID}/tblSubmissions`);
    expect(submissionUpserts).toHaveLength(3);
    expect(
      submissionUpserts.map((call) => (call.body?.records as unknown[]).length),
    ).toEqual([AIRTABLE_BATCH_SIZE, AIRTABLE_BATCH_SIZE, 3]);

    for (const call of airtable.upserts()) {
      expect(call.body?.performUpsert).toEqual({ fieldsToMergeOn: [GREENROOM_ID_FIELD] });
      expect(call.body?.typecast).toBe(true);
    }

    expect(summary.tables.Submissions.created).toBe(23);
    expect(summary.created).toBe(24); // 23 submissions + the event itself
  });
});

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

describe("runAirtableSync — rate limits", () => {
  it("waits out a 429 once and retries the same batch", async () => {
    vi.useFakeTimers({ now: NOW });
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES], rateLimit: 1 });

    const pending = runAirtableSync(context({ events: [event()] }, airtable));
    await vi.advanceTimersByTimeAsync(60_000);
    const summary = await pending;

    const upserts = airtable.upserts();
    expect(upserts).toHaveLength(2);
    // Airtable's own penalty window, per D-002's investigation.
    expect(upserts[1].at - upserts[0].at).toBe(30_000);
    expect(upserts[0].body).toEqual(upserts[1].body);
    expect(summary.tables.Events).toEqual({ created: 1, updated: 0, deleted: 0, failed: 0 });
    expect(summary.errors).toEqual([]);
  });

  it("gives up on the batch after a second 429 and counts it as failed", async () => {
    vi.useFakeTimers({ now: NOW });
    const airtable = fakeAirtable({ existingTables: [...AIRTABLE_TABLES], rateLimit: 2 });

    const pending = runAirtableSync(context({ events: [event()] }, airtable));
    await vi.advanceTimersByTimeAsync(120_000);
    const summary = await pending;

    // Exactly one retry — not a loop that keeps hammering a limited base.
    expect(airtable.upserts()).toHaveLength(2);
    expect(summary.tables.Events).toEqual({ created: 0, updated: 0, deleted: 0, failed: 1 });
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]).toContain("Events");
    expect(summary.errors[0]).toContain("429");
    // A rate-limited run is still a completed run: the cron must not see a throw.
    expect(summary.skipped).toBe(false);
  });
});
