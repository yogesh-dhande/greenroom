import { describe, expect, it } from "vitest";
import type {
  Event,
  EventSpeaker,
  Session,
  SessionRevision,
  Submission,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  AdminWorkflowError,
  createSession,
  createSpeaker,
  decideSubmission,
  defaultDecisionNotify,
  placeSession,
  setSpeakerConfirmation,
  suggestSessionSlot,
  unscheduleSession,
  updateSession,
  updateSpeaker,
} from "@/domain/admin-api";

const EPOCH = new Date(0);

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    name: "AI Engineer",
    slug: "aie",
    description: null,
    startDate: "2026-05-12",
    endDate: "2026-05-13",
    timezone: "America/Los_Angeles",
    location: null,
    programPublished: false,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "usr-1",
    email: "speaker@example.com",
    emailVerified: true,
    name: "Ada Lovelace",
    role: "speaker",
    title: null,
    company: null,
    bio: null,
    headshotUrl: null,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses-1",
    eventId: "evt-1",
    title: "Retrieval in production",
    description: "The old abstract",
    submissionId: null,
    trackId: null,
    roomId: null,
    day: null,
    startTime: "09:00",
    endTime: "09:30",
    status: "confirmed",
    contentStatus: "approved",
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "sub-1",
    eventId: "evt-1",
    formId: "form-1",
    title: "A proposal",
    description: null,
    answers: {},
    status: "submitted",
    resumeToken: null,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

describe("admin workflow speaker parity", () => {
  it("deduplicates by normalized email, preserves an admin role, and fills only blank fields", async () => {
    let saved = user({
      id: "adm-1",
      email: "ada@example.com",
      name: "Existing Name",
      role: "admin",
      company: "Existing Co",
    });
    const memberships: string[] = [];
    const repos = {
      events: { getById: async () => event() },
      users: {
        getByEmail: async (email: string) =>
          email === "ada@example.com" ? saved : null,
        update: async (_id: string, patch: Partial<User>) =>
          (saved = { ...saved, ...patch }),
      },
      eventSpeakers: {
        add: async (eventId: string, userId: string) => {
          memberships.push(`${eventId}/${userId}`);
          return {} as EventSpeaker;
        },
      },
    } as unknown as Repos;

    const result = await createSpeaker({ repos }, "evt-1", {
      name: "Replacement Name",
      email: "ADA@example.com",
      title: "Principal Engineer",
      company: "Replacement Co",
      bio: "Speaker bio",
    });

    expect(result.created).toBe(false);
    expect(result.speaker.role).toBe("admin");
    expect(result.speaker.name).toBe("Existing Name");
    expect(result.speaker.company).toBe("Existing Co");
    expect(result.speaker.title).toBe("Principal Engineer");
    expect(result.filled.sort()).toEqual(["bio", "title"]);
    expect(memberships).toEqual(["evt-1/adm-1"]);
  });

  it("updates organizer-owned profile/notes and writes a three-state confirmation override", async () => {
    let saved = user();
    let notes: string | null = null;
    let confirmation: "confirmed" | "declined" | null = null;
    const repos = {
      events: { getById: async () => event() },
      users: {
        getById: async () => saved,
        update: async (_id: string, patch: Partial<User>) =>
          (saved = { ...saved, ...patch }),
      },
      eventSpeakers: {
        get: async () => ({ userId: saved.id }),
        setNotes: async (
          _eventId: string,
          _userId: string,
          value: string | null,
        ) => {
          notes = value;
          return {} as EventSpeaker;
        },
        setConfirmation: async (
          _eventId: string,
          _userId: string,
          value: "confirmed" | "declined" | null,
        ) => {
          confirmation = value;
          return {} as EventSpeaker;
        },
      },
      taskAssignments: { listByEvent: async () => [] },
      sessions: { listBySpeaker: async () => [] },
    } as unknown as Repos;

    const result = await updateSpeaker({ repos }, "evt-1", "usr-1", {
      name: "Ada Byron",
      notes: "Vegetarian; aisle seat",
    });
    await setSpeakerConfirmation({ repos }, "evt-1", "usr-1", "declined");

    expect(result.name).toBe("Ada Byron");
    expect(notes).toBe("Vegetarian; aisle seat");
    expect(confirmation).toBe("declined");
  });
});

describe("admin workflow session parity", () => {
  it("creates a confirmed, approved, unscheduled direct session and reuses speakers", async () => {
    const existing = user({ id: "usr-existing", role: "admin" });
    let createdSession: Session | null = null;
    let assigned: string[] = [];
    const repos = {
      events: { getById: async () => event() },
      tracks: { getById: async () => ({ id: "track-1", eventId: "evt-1" }) },
      users: {
        getByEmail: async () => existing,
        getById: async () => existing,
      },
      eventSpeakers: {
        get: async (_eventId: string, userId: string) =>
          userId === existing.id ? ({ userId } as EventSpeaker) : null,
      },
      taskAssignments: { listByEvent: async () => [] },
      sessions: {
        listBySpeaker: async () => [],
        create: async (
          input: Omit<Session, "id" | "createdAt" | "updatedAt">,
        ) => {
          createdSession = session({ id: "ses-new", ...input });
          return createdSession;
        },
        setSpeakers: async (_sessionId: string, ids: string[]) => {
          assigned = ids;
        },
      },
    } as unknown as Repos;

    const result = await createSession({ repos }, "evt-1", {
      title: "Sponsor keynote",
      trackId: "track-1",
      speakerIds: ["usr-existing"],
      newSpeakers: [{ name: "Same person", email: existing.email }],
    });

    expect(result.session).toMatchObject({
      status: "confirmed",
      contentStatus: "approved",
      submissionId: null,
      day: null,
      roomId: null,
    });
    expect(createdSession).not.toBeNull();
    expect(assigned).toEqual(["usr-existing"]);
    expect(existing.role).toBe("admin");
  });

  it("refuses an existing speaker id that is outside the event roster", async () => {
    const repos = {
      events: { getById: async () => event() },
      eventSpeakers: { get: async () => null },
      taskAssignments: { listByEvent: async () => [] },
      sessions: { listBySpeaker: async () => [] },
    } as unknown as Repos;

    await expect(
      createSession({ repos }, "evt-1", {
        title: "Cross-event speaker",
        speakerIds: ["usr-from-another-event"],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AdminWorkflowError>>({
        code: "not_found",
        message: "Speaker not found",
      }),
    );
  });

  it("updates the canonical abstract and appends an actor-attributed revision", async () => {
    let stored = session();
    const revisions: Array<Omit<SessionRevision, "id" | "createdAt">> = [];
    const repos = {
      events: { getById: async () => event() },
      sessions: {
        getById: async () => stored,
        update: async (_id: string, patch: Partial<Session>) =>
          (stored = { ...stored, ...patch }),
      },
      tracks: { getById: async () => null },
      sessionRevisions: {
        create: async (input: Omit<SessionRevision, "id" | "createdAt">) => {
          revisions.push(input);
          return { id: "rev-1", createdAt: EPOCH, ...input } as SessionRevision;
        },
      },
    } as unknown as Repos;

    const result = await updateSession({ repos }, "evt-1", "ses-1", "adm-1", {
      description: "  A better abstract  ",
    });

    expect(result.description).toBe("A better abstract");
    expect(revisions).toEqual([
      {
        sessionId: "ses-1",
        field: "abstract",
        priorValue: "The old abstract",
        newValue: "A better abstract",
        authorUserId: "adm-1",
      },
    ]);
  });

  it("retains duration when unscheduling", async () => {
    let stored = session({
      day: "2026-05-12",
      roomId: "room-1",
      startTime: "10:15",
      endTime: "10:30",
    });
    const repos = {
      sessions: {
        getById: async () => stored,
        update: async (_id: string, patch: Partial<Session>) =>
          (stored = { ...stored, ...patch }),
      },
    } as unknown as Repos;

    const result = await unscheduleSession({ repos }, "evt-1", "ses-1");
    expect(result).toMatchObject({
      day: null,
      roomId: null,
      startTime: "10:15",
      endTime: "10:30",
    });
  });

  it("allows placement conflicts but reports every resulting severity", async () => {
    let moving = session({ day: null, roomId: null });
    const other = session({
      id: "ses-2",
      title: "Other talk",
      day: "2026-05-12",
      roomId: "room-1",
      trackId: "track-1",
      startTime: "09:00",
      endTime: "10:00",
    });
    const repos = {
      sessions: {
        getById: async () => moving,
        update: async (_id: string, patch: Partial<Session>) =>
          (moving = { ...moving, ...patch, trackId: "track-1" }),
        listByEvent: async () => [moving, other],
        listSpeakersBySessionIds: async () => [
          { sessionId: "ses-1", userId: "usr-1" },
          { sessionId: "ses-2", userId: "usr-1" },
        ],
      },
      rooms: { getById: async () => ({ id: "room-1", eventId: "evt-1" }) },
    } as unknown as Repos;

    const result = await placeSession({ repos }, "evt-1", "ses-1", {
      day: "2026-05-12",
      roomId: "room-1",
      startTime: "09:15",
      endTime: "09:45",
    });

    expect(result.session.day).toBe("2026-05-12");
    expect(
      result.conflicts.map((conflict) => [conflict.type, conflict.severity]),
    ).toEqual([
      ["room_double_booked", "blocking"],
      ["speaker_double_booked", "blocking"],
      ["track_overlap", "advisory"],
    ]);
  });

  it("suggests the earliest free slot with the session's remembered duration", async () => {
    const target = session({ startTime: "09:00", endTime: "09:15" });
    const occupied = session({
      id: "ses-2",
      day: "2026-05-12",
      roomId: "room-1",
      startTime: "08:00",
      endTime: "08:15",
    });
    const repos = {
      events: { getById: async () => event({ endDate: "2026-05-12" }) },
      sessions: {
        getById: async () => target,
        listByEvent: async () => [target, occupied],
        listSpeakersBySessionIds: async () => [],
      },
      rooms: { listByEvent: async () => [{ id: "room-1", eventId: "evt-1" }] },
    } as unknown as Repos;

    await expect(
      suggestSessionSlot({ repos }, "evt-1", "ses-1"),
    ).resolves.toEqual({
      day: "2026-05-12",
      roomId: "room-1",
      startTime: "08:15",
      endTime: "08:30",
    });
  });
});

describe("admin workflow decision parity", () => {
  it("defaults accept and decline to email, and waitlist to silent", () => {
    expect(defaultDecisionNotify("approved")).toBe(true);
    expect(defaultDecisionNotify("denied")).toBe(true);
    expect(defaultDecisionNotify("maybe")).toBe(false);
  });

  it("records a default-silent waitlist through the existing conversion/cancellation service", async () => {
    let stored = submission();
    const repos = {
      submissions: {
        getById: async () => stored,
        update: async (_id: string, patch: Partial<Submission>) =>
          (stored = { ...stored, ...patch }),
      },
      sessions: { getBySubmission: async () => null },
    } as unknown as Repos;

    const result = await decideSubmission(
      { repos },
      "evt-1",
      "sub-1",
      "adm-1",
      {
        decision: "maybe",
      },
    );
    expect(result.submission.status).toBe("maybe");
    expect(result.deliveries).toEqual([]);
  });

  it("requires a communication transport when an email-on decision uses its default", async () => {
    const repos = {
      submissions: { getById: async () => submission() },
    } as unknown as Repos;
    await expect(
      decideSubmission({ repos }, "evt-1", "sub-1", "adm-1", {
        decision: "approved",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AdminWorkflowError>>({
        code: "unavailable",
        message: "Email delivery is not configured",
      }),
    );
  });
});
