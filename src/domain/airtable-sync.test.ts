import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Event,
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
  body: Record<string, unknown> | null;
  at: number;
}

function allFieldsOf(table: AirtableTableName) {
  return AIRTABLE_TABLE_FIELDS[table].map((field) => ({ name: field.name, type: field.type }));
}

/**
 * Stands in for the Airtable REST API: the Metadata endpoints keep a table
 * list in memory, and the upsert endpoint reports everything as created.
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
} = {}) {
  const tables = new Map<string, { id: string; name: string; fields: { name: string }[] }>();
  for (const name of options.existingTables ?? []) {
    const only = options.existingFields?.[name];
    tables.set(name, {
      id: `tbl${name}`,
      name,
      fields: only ? only.map((field) => ({ name: field })) : allFieldsOf(name),
    });
  }

  const calls: Call[] = [];
  let remainingRateLimits = options.rateLimit ?? 0;

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

  const fetchImpl = (async (input: string, init?: { method?: string; body?: string }) => {
    const path = new URL(input).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path, body, at: Date.now() });

    if (method === "GET" && path === `/v0/meta/bases/${BASE_ID}/tables`) {
      return json({ tables: [...tables.values()] });
    }

    if (method === "POST" && path === `/v0/meta/bases/${BASE_ID}/tables`) {
      const name = String(body?.name);
      const fields = (body?.fields as { name: string }[]) ?? [];
      const created = { id: `tbl${name}`, name, fields };
      tables.set(name, created);
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

    if (method === "PATCH" && path.startsWith(`/v0/${BASE_ID}/`)) {
      if (remainingRateLimits > 0) {
        remainingRateLimits -= 1;
        return json({ error: "RATE_LIMIT_REACHED" }, 429);
      }
      const records = (body?.records as unknown[]) ?? [];
      return json({
        records,
        createdRecords: records.map((_, index) => `rec${index}`),
        updatedRecords: [],
      });
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
  };
}

function context(seed: Seed, airtable: ReturnType<typeof fakeAirtable>) {
  return {
    repos: fakeRepos(seed),
    airtable: { apiKey: "pat-test", baseId: BASE_ID },
    fetchImpl: airtable.fetchImpl,
    // The 250 ms production spacing is a rate-limit courtesy, not behaviour
    // under test; the 429 path below drives the timer instead.
    requestSpacingMs: 0,
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
    expect(summary.tables.Events).toEqual({ created: 1, updated: 0, failed: 0 });
    expect(summary.errors.join(" ")).toContain("couldn't add field");
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
    expect(summary.tables.Events).toEqual({ created: 1, updated: 0, failed: 0 });
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
    expect(summary.tables.Events).toEqual({ created: 0, updated: 0, failed: 1 });
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]).toContain("Events");
    expect(summary.errors[0]).toContain("429");
    // A rate-limited run is still a completed run: the cron must not see a throw.
    expect(summary.skipped).toBe(false);
  });
});
