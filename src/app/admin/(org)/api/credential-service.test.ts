import { describe, expect, it, vi } from "vitest";
import type { ApiCredential, Event, NewApiCredential } from "@/db/entities";
import type { Repos } from "@/db/repos";
import type { ApiCredentialsRepo } from "@/db/repos/api-credentials";
import { toApiCredentialRow } from "./credential-presentation";
import { createApiCredentialAdminService } from "./credential-service";

function event(id: string): Event {
  return {
    id,
    name: `Event ${id}`,
    slug: `event-${id}`,
    description: null,
    startDate: null,
    endDate: null,
    timezone: "UTC",
    location: null,
    programPublished: false,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function credential(overrides: Partial<ApiCredential> = {}): ApiCredential {
  return {
    id: "key-1",
    ownerUserId: "admin-1",
    label: "Schedule sync",
    keyPrefix: "gr_abcd1234",
    permission: "write",
    eventAccess: "selected",
    eventIds: ["event-1"],
    expiresAt: new Date("2026-11-08T12:00:00.000Z"),
    revoked: false,
    lastUsedAt: new Date("2026-08-10T09:30:00.000Z"),
    createdAt: new Date("2026-08-10T08:00:00.000Z"),
    updatedAt: new Date("2026-08-10T09:30:00.000Z"),
    ...overrides,
  };
}

function mockRepos({
  events = [],
  credentials = [],
}: {
  events?: Event[];
  credentials?: ApiCredential[];
} = {}) {
  const apiCredentials: ApiCredentialsRepo = {
    getById: vi.fn(async (id) => credentials.find((item) => item.id === id) ?? null),
    getBySecretHash: vi.fn(async () => null),
    listByOwnerId: vi.fn(async (ownerId) =>
      credentials.filter((item) => item.ownerUserId === ownerId),
    ),
    create: vi.fn(async (input: NewApiCredential) =>
      credential({
        ownerUserId: input.ownerUserId,
        label: input.label,
        keyPrefix: input.keyPrefix,
        permission: input.permission,
        eventAccess: input.eventAccess,
        eventIds: input.eventIds,
        expiresAt: input.expiresAt,
        lastUsedAt: null,
      }),
    ),
    setLastUsed: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
  };
  const repos = {
    apiCredentials,
    events: { listAll: vi.fn(async () => events) },
  } as unknown as Repos;
  return { repos, apiCredentials };
}

describe("toApiCredentialRow", () => {
  it("returns the compact serializable view without owner or auth internals", () => {
    const value = credential();

    expect(toApiCredentialRow(value)).toEqual({
      id: "key-1",
      label: "Schedule sync",
      prefix: "gr_abcd1234",
      permission: "write",
      eventAccess: "selected",
      eventIds: ["event-1"],
      expiresAt: "2026-11-08T12:00:00.000Z",
      lastUsedAt: "2026-08-10T09:30:00.000Z",
      createdAt: "2026-08-10T08:00:00.000Z",
    });
  });

  it("preserves a never-used key as null", () => {
    const value = credential({
      id: "key-2",
      label: "Read reports",
      keyPrefix: "gr_9876fedc",
      permission: "read",
      eventAccess: "all",
      eventIds: [],
      expiresAt: new Date("2027-08-10T08:00:00.000Z"),
      lastUsedAt: null,
    });

    expect(toApiCredentialRow(value).lastUsedAt).toBeNull();
  });
});

describe("ApiCredentialAdminService", () => {
  it("lists only the owner's active credentials", async () => {
    const { repos } = mockRepos({
      credentials: [
        credential(),
        credential({ id: "revoked", revoked: true }),
        credential({ id: "other", ownerUserId: "admin-2" }),
      ],
    });

    const rows = await createApiCredentialAdminService(repos).listCredentials("admin-1");

    expect(rows.map((row) => row.id)).toEqual(["key-1"]);
  });

  it("refuses a selected-event key when an event id is stale", async () => {
    const { repos, apiCredentials } = mockRepos({ events: [event("event-1")] });

    await expect(
      createApiCredentialAdminService(repos).createCredential("admin-1", {
        label: "Stale selection",
        permission: "read",
        eventAccess: "selected",
        eventIds: ["event-removed"],
        expiresInDays: 90,
      }),
    ).rejects.toThrow("selected events no longer exists");
    expect(apiCredentials.create).not.toHaveBeenCalled();
  });

  it("creates through the shared workflow without persisting the raw secret", async () => {
    const { repos, apiCredentials } = mockRepos({ events: [event("event-1")] });

    const result = await createApiCredentialAdminService(repos).createCredential("admin-1", {
      label: "Agenda automation",
      permission: "write",
      eventAccess: "selected",
      eventIds: ["event-1"],
      expiresInDays: 30,
    });

    expect(result.secret).toMatch(/^gr_[A-Za-z0-9_-]+$/);
    expect(result.credential).toMatchObject({
      label: "Agenda automation",
      permission: "write",
      eventAccess: "selected",
      eventIds: ["event-1"],
    });
    expect(apiCredentials.create).toHaveBeenCalledOnce();
    const persisted = vi.mocked(apiCredentials.create).mock.calls[0]?.[0];
    expect(persisted?.secretHash).not.toBe(result.secret);
    expect(JSON.stringify(persisted)).not.toContain(result.secret);
  });
});
