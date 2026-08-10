import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventSpeaker, Session, SessionSpeaker, User } from "@/db/entities";

/**
 * The public loaders' one non-obvious rule: a speaker the organizer marked
 * **declined** (decisions.md D-068) is dropped from every public surface, even
 * though they are still linked to the session. The filter lives in the shared
 * loader precisely so no surface can forget it, so it is tested there rather
 * than once per page.
 */

const repos = {
  events: { getBySlug: vi.fn() },
  sessions: { listByEvent: vi.fn(), listSpeakersBySessionIds: vi.fn() },
  eventSpeakers: { listByEvent: vi.fn() },
  users: { listByIds: vi.fn() },
  tracks: { listByEvent: vi.fn() },
  rooms: { listByEvent: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getRepos: async () => repos }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

/** The loaders are `cache()`-wrapped, so every test imports the module afresh
 * (see the `resetModules` in `beforeEach`) rather than sharing one memo. */
const loadData = () => import("./data");

const EVENT = {
  id: "evt-1",
  slug: "summit",
  name: "AI Engineer Summit 2026",
  timezone: "America/Los_Angeles",
  programPublished: true,
} as unknown as Event;

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    eventId: "evt-1",
    title: overrides.id,
    description: null,
    submissionId: null,
    trackId: null,
    roomId: null,
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:30",
    status: "confirmed",
    contentStatus: "approved",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Session;
}

function user(id: string, name: string): User {
  return {
    id,
    email: `${id}@example.com`,
    name,
    title: null,
    company: null,
    bio: null,
    headshotUrl: null,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
  } as unknown as User;
}

function member(userId: string, confirmationStatus: EventSpeaker["confirmationStatus"]) {
  return { eventId: "evt-1", userId, notes: null, confirmationStatus } as EventSpeaker;
}

function link(sessionId: string, userId: string): SessionSpeaker {
  return { sessionId, userId } as SessionSpeaker;
}

describe("public program loaders honour stored confirmations (D-068)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // React's cache() memoizes per request; each test gets a fresh module
    // registry so one test's loads never answer another's.
    vi.resetModules();
    repos.events.getBySlug.mockResolvedValue(EVENT);
    repos.tracks.listByEvent.mockResolvedValue([]);
    repos.rooms.listByEvent.mockResolvedValue([]);
    repos.sessions.listByEvent.mockResolvedValue([
      session({ id: "s1", title: "Retrieval at scale" }),
    ]);
    repos.sessions.listSpeakersBySessionIds.mockResolvedValue([
      link("s1", "u1"),
      link("s1", "u2"),
    ]);
    repos.users.listByIds.mockImplementation(async (ids: string[]) =>
      [user("u1", "Priya Raman"), user("u2", "Ada Lovelace")].filter((u) => ids.includes(u.id)),
    );
  });

  it("keeps every speaker while no confirmation is stored", async () => {
    repos.eventSpeakers.listByEvent.mockResolvedValue([]);
    const { getGallery: load } = await loadData();

    expect((await load("summit")).map((s) => s.name)).toEqual(["Ada Lovelace", "Priya Raman"]);
  });

  it("drops a declined speaker from the gallery", async () => {
    repos.eventSpeakers.listByEvent.mockResolvedValue([member("u2", "declined")]);
    const { getGallery: load } = await loadData();

    expect((await load("summit")).map((s) => s.name)).toEqual(["Priya Raman"]);
  });

  it("drops a declined speaker from the session byline on the schedule", async () => {
    repos.eventSpeakers.listByEvent.mockResolvedValue([member("u1", "declined")]);
    const { getSchedule: load } = await loadData();

    const [day] = await load("summit");
    expect(day.slots[0].sessions[0].speakers.map((s) => s.name)).toEqual(["Ada Lovelace"]);
  });

  it("still renders a session whose whole lineup declined, with no speakers", async () => {
    repos.eventSpeakers.listByEvent.mockResolvedValue([
      member("u1", "declined"),
      member("u2", "declined"),
    ]);
    const { getSchedule: load, getGallery: loadGallery } = await loadData();

    const [day] = await load("summit");
    expect(day.slots[0].sessions[0].title).toBe("Retrieval at scale");
    expect(day.slots[0].sessions[0].speakers).toEqual([]);
    expect(await loadGallery("summit")).toEqual([]);
  });

  it("an explicit 'confirmed' override changes nothing on a linked speaker", async () => {
    repos.eventSpeakers.listByEvent.mockResolvedValue([member("u1", "confirmed")]);
    const { getGallery: load } = await loadData();

    expect((await load("summit")).map((s) => s.name)).toEqual(["Ada Lovelace", "Priya Raman"]);
  });
});
