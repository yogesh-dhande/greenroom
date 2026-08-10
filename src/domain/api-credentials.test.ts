import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ApiCredential, NewApiCredential, User } from "@/db/entities";
import type { ApiCredentialsRepo } from "@/db/repos/api-credentials";
import type { UsersRepo } from "@/db/repos/users";
import {
  apiCredentialCanAccessEvent,
  authenticateApiCredential,
  authorizeApiCredential,
  createApiCredential,
  DEFAULT_API_KEY_EXPIRY_DAYS,
  generateApiKeySecret,
  hasApiCredentialPermission,
  hashApiKey,
  revokeApiCredential,
} from "./api-credentials";

const now = new Date("2026-08-10T12:00:00.000Z");

function credential(patch: Partial<ApiCredential> = {}): ApiCredential {
  return {
    id: "key-1",
    ownerUserId: "admin-1",
    label: "Automation",
    keyPrefix: "gr_abcdefgh",
    permission: "read",
    eventAccess: "all",
    eventIds: [],
    expiresAt: new Date("2026-11-08T12:00:00.000Z"),
    revoked: false,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function user(patch: Partial<User> = {}): User {
  return {
    id: "admin-1",
    email: "admin@example.com",
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
    ...patch,
  };
}

function credentialRepo(overrides: Partial<ApiCredentialsRepo> = {}): ApiCredentialsRepo {
  return {
    getById: vi.fn(async () => null),
    getBySecretHash: vi.fn(async () => null),
    listByOwnerId: vi.fn(async () => []),
    create: vi.fn(async () => credential()),
    setLastUsed: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
    ...overrides,
  };
}

function usersRepo(overrides: Partial<UsersRepo> = {}): UsersRepo {
  return {
    getById: vi.fn(async () => null),
    getByEmail: vi.fn(async () => null),
    listByIds: vi.fn(async () => []),
    listByRole: vi.fn(async () => []),
    listAll: vi.fn(async () => []),
    create: vi.fn(async () => user()),
    update: vi.fn(async () => user()),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("API credential creation", () => {
  it("generates a high-entropy gr_ secret whose SHA-256 digest matches Better Auth", async () => {
    const secret = generateApiKeySecret();
    expect(secret).toMatch(/^gr_[A-Za-z0-9_-]{64}$/);
    const expected = createHash("sha256").update(secret).digest("base64url");
    expect(await hashApiKey(secret)).toBe(expected);
  });

  it("shows the secret once while persisting only its hash and safe prefix", async () => {
    let written: NewApiCredential | undefined;
    const repo = credentialRepo({
      create: vi.fn(async (input) => {
        written = input;
        return credential({
          label: input.label,
          keyPrefix: input.keyPrefix,
          permission: input.permission,
          eventAccess: input.eventAccess,
          eventIds: input.eventIds,
          expiresAt: input.expiresAt,
        });
      }),
    });

    const result = await createApiCredential(
      repo,
      {
        ownerUserId: "admin-1",
        label: "  Agenda sync  ",
        permission: "write",
        eventAccess: "selected",
        eventIds: ["event-1", "event-1", "event-2"],
      },
      now,
    );

    expect(result.secret).toMatch(/^gr_/);
    expect(written).toMatchObject({
      label: "Agenda sync",
      permission: "write",
      eventAccess: "selected",
      eventIds: ["event-1", "event-2"],
      keyPrefix: result.secret.slice(0, 11),
      expiresAt: new Date(now.getTime() + DEFAULT_API_KEY_EXPIRY_DAYS * 86_400_000),
    });
    expect(written?.secretHash).toBe(await hashApiKey(result.secret));
    expect(JSON.stringify(written)).not.toContain(result.secret);
    expect(result.credential).not.toHaveProperty("secretHash");
  });

  it.each([30, 90, 365] as const)("supports a %d-day expiry", async (expiresInDays) => {
    let written: NewApiCredential | undefined;
    const repo = credentialRepo({
      create: vi.fn(async (input) => {
        written = input;
        return credential({ expiresAt: input.expiresAt });
      }),
    });
    await createApiCredential(
      repo,
      {
        ownerUserId: "admin-1",
        label: "Key",
        permission: "read",
        eventAccess: "all",
        expiresInDays,
      },
      now,
    );
    expect(written?.expiresAt.getTime()).toBe(now.getTime() + expiresInDays * 86_400_000);
  });

  it("requires at least one event for a selected-event key", async () => {
    await expect(
      createApiCredential(credentialRepo(), {
        ownerUserId: "admin-1",
        label: "Key",
        permission: "read",
        eventAccess: "selected",
        eventIds: [],
      }),
    ).rejects.toThrow("Choose at least one event");
  });
});

describe("API credential authorization", () => {
  it("makes write imply read while read cannot satisfy write", () => {
    expect(hasApiCredentialPermission("write", "read")).toBe(true);
    expect(hasApiCredentialPermission("write", "write")).toBe(true);
    expect(hasApiCredentialPermission("read", "read")).toBe(true);
    expect(hasApiCredentialPermission("read", "write")).toBe(false);
  });

  it("lets all-event keys cover future ids and selected keys cover only their allowlist", () => {
    expect(apiCredentialCanAccessEvent(credential(), "future-event")).toBe(true);
    const selected = credential({ eventAccess: "selected", eventIds: ["event-1"] });
    expect(apiCredentialCanAccessEvent(selected, "event-1")).toBe(true);
    expect(apiCredentialCanAccessEvent(selected, "event-2")).toBe(false);
  });

  it("uses 404 for an out-of-scope event, even when a write is also forbidden", () => {
    expect(
      authorizeApiCredential(
        credential({ eventAccess: "selected", eventIds: ["event-1"] }),
        user(),
        { eventId: "event-2", requiredPermission: "write", now },
      ),
    ).toEqual({ ok: false, status: 404, code: "not_found" });
  });

  it("rejects revoked and expired credentials", () => {
    expect(authorizeApiCredential(credential({ revoked: true }), user(), { now })).toEqual({
      ok: false,
      status: 401,
      code: "invalid_credential",
    });
    expect(authorizeApiCredential(credential({ expiresAt: now }), user(), { now })).toEqual({
      ok: false,
      status: 401,
      code: "invalid_credential",
    });
  });

  it.each([null, user({ role: "reviewer" }), user({ role: "speaker" })])(
    "requires the owner to still be an active admin on every check",
    (owner) => {
      expect(authorizeApiCredential(credential(), owner, { now })).toEqual({
        ok: false,
        status: 401,
        code: "inactive_credential_owner",
      });
    },
  );

  it("loads the owner on each authentication and records only successful last use", async () => {
    const secret = "gr_test-secret";
    const apiCredentials = credentialRepo({
      getBySecretHash: vi.fn(async () => credential()),
    });
    const users = usersRepo({ getById: vi.fn(async () => user()) });

    const first = await authenticateApiCredential(
      { apiCredentials, users },
      secret,
      { requiredPermission: "read", now },
    );
    expect(first.ok).toBe(true);
    expect(users.getById).toHaveBeenCalledTimes(1);
    expect(apiCredentials.setLastUsed).toHaveBeenCalledWith("key-1", now);

    vi.mocked(users.getById).mockResolvedValue(user({ role: "reviewer" }));
    const second = await authenticateApiCredential(
      { apiCredentials, users },
      secret,
      { requiredPermission: "read", now: new Date(now.getTime() + 1_000) },
    );
    expect(second).toMatchObject({ ok: false, code: "inactive_credential_owner" });
    expect(users.getById).toHaveBeenCalledTimes(2);
    expect(apiCredentials.setLastUsed).toHaveBeenCalledTimes(1);
  });
});

describe("API credential revocation", () => {
  it("revokes only a key owned by the caller", async () => {
    const repo = credentialRepo({ getById: vi.fn(async () => credential()) });
    await revokeApiCredential(repo, "key-1", "admin-1");
    expect(repo.revoke).toHaveBeenCalledWith("key-1");

    await expect(revokeApiCredential(repo, "key-1", "admin-2")).rejects.toThrow(
      "API credential not found",
    );
    expect(repo.revoke).toHaveBeenCalledTimes(1);
  });
});
