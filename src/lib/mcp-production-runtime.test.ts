import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, Session, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import type { McpExecutionContext } from "@/lib/mcp-runtime";

const mocks = vi.hoisted(() => ({
  authenticateExternalRequest: vi.fn(),
  createSpeaker: vi.fn(),
  getCommsContext: vi.fn(),
  getRepos: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({ getRepos: mocks.getRepos }));
vi.mock("@/lib/comms-context", () => ({ getCommsContext: mocks.getCommsContext }));
vi.mock("@/lib/external-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/external-auth")>()),
  authenticateExternalRequest: mocks.authenticateExternalRequest,
}));
vi.mock("@/domain/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/admin-api")>()),
  createSpeaker: mocks.createSpeaker,
}));

import { productionMcpRuntime } from "@/lib/mcp-production-runtime";
import { McpOperationError } from "@/lib/mcp-runtime";

const now = new Date("2026-08-10T12:00:00.000Z");
const event: Event = {
  id: "event-1",
  name: "AI Engineer World's Fair",
  slug: "ai-engineer-worlds-fair",
  description: "An event",
  startDate: "2026-08-12",
  endDate: "2026-08-13",
  timezone: "America/Los_Angeles",
  location: "San Francisco",
  programPublished: true,
  createdAt: now,
  updatedAt: now,
};
const admin: User = {
  id: "admin-1",
  email: "admin@example.test",
  emailVerified: true,
  name: "Admin",
  role: "admin",
  title: null,
  company: null,
  bio: null,
  headshotUrl: null,
  websiteUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  socials: null,
  image: null,
  createdAt: now,
  updatedAt: now,
};
const speaker: User = {
  ...admin,
  id: "speaker-1",
  email: "speaker@example.test",
  name: "Ada Speaker",
  role: "speaker",
};

function session(id: string, trackId: string | null, day: string | null): Session {
  return {
    id,
    eventId: event.id,
    submissionId: null,
    trackId,
    roomId: day ? "room-1" : null,
    title: id === "session-1" ? "Keynote" : "Workshop",
    description: null,
    status: "confirmed",
    contentStatus: "approved",
    day,
    startTime: day ? "09:00" : null,
    endTime: day ? "09:30" : null,
    createdAt: now,
    updatedAt: now,
  };
}

function fakeRepos(): Repos {
  const sessions = [session("session-1", "track-1", "2026-08-12"), session("session-2", null, null)];
  return {
    events: {
      listAll: vi.fn(async () => [event]),
      getById: vi.fn(async (id: string) => (id === event.id ? event : null)),
    },
    sessions: {
      listByEvent: vi.fn(async () => sessions),
      listSpeakersBySessionIds: vi.fn(async () => []),
      getById: vi.fn(async (id: string) => sessions.find((item) => item.id === id) ?? null),
      listBySpeaker: vi.fn(async () => []),
    },
    tracks: {
      listByEvent: vi.fn(async () => [
        { id: "track-1", eventId: event.id, name: "Main", color: null, createdAt: now, updatedAt: now },
      ]),
      getById: vi.fn(async () => null),
    },
    rooms: {
      listByEvent: vi.fn(async () => [
        { id: "room-1", eventId: event.id, name: "Hall A", capacity: 100, createdAt: now, updatedAt: now },
      ]),
      getById: vi.fn(async () => null),
    },
    users: {
      listByIds: vi.fn(async (ids: string[]) => [admin, speaker].filter((user) => ids.includes(user.id))),
      getById: vi.fn(async (id: string) => [admin, speaker].find((user) => user.id === id) ?? null),
    },
    taskAssignments: { listByEvent: vi.fn(async () => []) },
    eventSpeakers: {
      listByEvent: vi.fn(async () => [
        { eventId: event.id, userId: speaker.id, notes: null, confirmationStatus: null, createdAt: now, updatedAt: now },
      ]),
      get: vi.fn(async () => ({
        eventId: event.id,
        userId: speaker.id,
        notes: null,
        confirmationStatus: null,
        createdAt: now,
        updatedAt: now,
      })),
    },
  } as unknown as Repos;
}

function context(overrides: Partial<McpExecutionContext["principal"]> = {}): McpExecutionContext {
  return {
    requestId: "request-1",
    principal: {
      userId: admin.id,
      credentialId: "key-1",
      scopes: ["greenroom:read", "greenroom:write"],
      ...overrides,
    },
  };
}

describe("production MCP runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRepos.mockResolvedValue(fakeRepos());
  });

  it("maps MCP session filter names into the strict shared collection query", async () => {
    const result = await productionMcpRuntime.callTool(
      "list_sessions",
      { eventId: event.id, page: 1, pageSize: 25, trackId: "track-1", scheduled: true },
      context(),
    );

    expect(result.envelope).toMatchObject({
      data: [{ id: "session-1", track: { id: "track-1" }, schedulingStatus: "scheduled" }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    });
  });

  it("reads an event resource through the same DTO mapping as the get_event tool", async () => {
    const result = await productionMcpRuntime.readResource(
      "greenroom://events/event-1",
      context(),
    );

    expect(result.envelope).toMatchObject({
      data: { id: event.id, name: event.name, description: event.description },
    });
  });

  it("uses the shared admin workflow for writes and returns a redacted speaker DTO", async () => {
    mocks.createSpeaker.mockResolvedValue({ speaker, created: true, filled: [] });
    const result = await productionMcpRuntime.callTool(
      "add_speaker",
      { eventId: event.id, name: speaker.name, email: speaker.email },
      context(),
    );

    expect(mocks.createSpeaker).toHaveBeenCalledWith(
      { repos: expect.any(Object) },
      event.id,
      { name: speaker.name, email: speaker.email },
    );
    expect(result.envelope).toMatchObject({ data: { id: speaker.id, email: speaker.email } });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("conceals an event outside the credential allowlist before a read or write", async () => {
    await expect(
      productionMcpRuntime.callTool(
        "get_event",
        { eventId: event.id },
        context({ eventIds: ["another-event"] }),
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("maps missing records into safe structured application errors", async () => {
    await expect(
      productionMcpRuntime.callTool("get_event", { eventId: "missing" }, context()),
    ).rejects.toBeInstanceOf(McpOperationError);
    await expect(
      productionMcpRuntime.callTool("get_event", { eventId: "missing" }, context()),
    ).rejects.toMatchObject({ code: "not_found", message: "Event not found." });
  });

  it("maps the shared external auth context without retaining a raw token", async () => {
    mocks.authenticateExternalRequest.mockResolvedValue({
      credentialId: "key-1",
      ownerId: admin.id,
      permission: "write",
      eventScope: [event.id],
      tokenType: "api_key",
    });
    const authenticated = await productionMcpRuntime.authenticate(
      new Request("https://greenroom.usespaces.dev/mcp"),
    );

    expect(authenticated).toEqual({
      ok: true,
      principal: {
        userId: admin.id,
        credentialId: "key-1",
        scopes: ["greenroom:read", "greenroom:write"],
        eventIds: [event.id],
      },
    });
  });
});
