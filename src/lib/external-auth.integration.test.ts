import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/db/entities";

const doubles = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  verifyAccessToken: vi.fn(),
  getById: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(async () => ({ api: { verifyApiKey: doubles.verifyApiKey } })),
}));
vi.mock("@/lib/db", () => ({
  getRepos: vi.fn(async () => ({ users: { getById: doubles.getById } })),
}));
vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: vi.fn(() => ({
    getActions: () => ({ verifyAccessToken: doubles.verifyAccessToken }),
  })),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { API_RATE_LIMITER: { limit: doubles.limit } },
  })),
}));

import { authenticateExternalRequest } from "./external-auth";

const admin = {
  id: "admin-1",
  email: "admin@example.com",
  role: "admin",
} as User;

function request(path: string, token: string): Request {
  return new Request(`https://greenroom.test${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("external authentication composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.getById.mockResolvedValue(admin);
    doubles.limit.mockResolvedValue({ success: true });
  });

  it("resolves a Better Auth API key, its write scope, and selected events", async () => {
    doubles.verifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: "key-1",
        referenceId: admin.id,
        permissions: { greenroom: ["read", "write"] },
        metadata: { eventAccess: "selected", eventIds: ["event-1"] },
      },
    });

    await expect(
      authenticateExternalRequest(request("/api/v1/events/event-1", "gr_secret"), "event-1"),
    ).resolves.toEqual({
      credentialId: "key-1",
      ownerId: admin.id,
      permission: "write",
      eventScope: ["event-1"],
      tokenType: "api_key",
    });
    expect(doubles.getById).toHaveBeenCalledWith(admin.id);
    expect(doubles.limit).toHaveBeenCalledWith({ key: "key-1" });
  });

  it("verifies an OAuth bearer for the protected-resource audience", async () => {
    doubles.verifyAccessToken.mockResolvedValue({
      sub: admin.id,
      scope: "greenroom:read greenroom:write",
    });

    const result = await authenticateExternalRequest(
      request("/mcp", "eyJhbGciOiJFZERTQSJ9.payload.signature"),
    );

    expect(result).toMatchObject({
      ownerId: admin.id,
      permission: "write",
      eventScope: "all",
      tokenType: "oauth",
    });
    expect(result.credentialId).toMatch(/^oauth:[a-f0-9]{64}$/);
    expect(doubles.verifyAccessToken).toHaveBeenCalledWith(
      "eyJhbGciOiJFZERTQSJ9.payload.signature",
      { verifyOptions: { audience: "https://greenroom.test/mcp" } },
    );
  });

  it("rechecks the owner role and rejects a demoted administrator", async () => {
    doubles.verifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: "key-1",
        referenceId: admin.id,
        permissions: { greenroom: ["read"] },
        metadata: { eventAccess: "all", eventIds: [] },
      },
    });
    doubles.getById.mockResolvedValue({ ...admin, role: "speaker" });

    await expect(
      authenticateExternalRequest(request("/api/v1/events", "gr_secret")),
    ).rejects.toMatchObject({
      status: 401,
      code: "inactive_credential_owner",
    });
    expect(doubles.limit).not.toHaveBeenCalled();
  });

  it("conceals an event outside a key allowlist before consuming rate limit", async () => {
    doubles.verifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: "key-1",
        referenceId: admin.id,
        permissions: { greenroom: ["read"] },
        metadata: { eventAccess: "selected", eventIds: ["event-1"] },
      },
    });

    await expect(
      authenticateExternalRequest(request("/api/v1/events/event-2", "gr_secret"), "event-2"),
    ).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    expect(doubles.limit).not.toHaveBeenCalled();
  });

  it("uses the stable credential id for throttling and returns retry metadata", async () => {
    doubles.verifyApiKey.mockResolvedValue({
      valid: true,
      key: {
        id: "key-1",
        referenceId: admin.id,
        permissions: { greenroom: ["read"] },
        metadata: { eventAccess: "all", eventIds: [] },
      },
    });
    doubles.limit.mockResolvedValue({ success: false });

    await expect(
      authenticateExternalRequest(request("/api/v1/events", "gr_secret")),
    ).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      details: { retryAfter: 60 },
    });
    expect(doubles.limit).toHaveBeenCalledWith({ key: "key-1" });
  });
});
