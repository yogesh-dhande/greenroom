import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  authenticateExternalRequest: vi.fn(),
  requireExternalScope: vi.fn(),
}));

vi.mock("@/lib/external-auth", () => ({
  ...authMocks,
  ExternalAuthError: class ExternalAuthError extends Error {
    constructor(
      readonly status: 401 | 403 | 404 | 429,
      readonly code: string,
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
      this.name = "ExternalAuthError";
    }
  },
}));

import { ExternalAuthError } from "@/lib/external-auth";
import { ApiError, authenticateApiRead, withApiRequest } from "./api-request";

describe("API request handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authenticates and requires read access for the requested event", async () => {
    const auth = {
      credentialId: "key-1",
      ownerId: "admin-1",
      permission: "write" as const,
      eventScope: ["event-1"],
      tokenType: "api_key" as const,
    };
    authMocks.authenticateExternalRequest.mockResolvedValue(auth);
    const request = new Request("https://greenroom.test/api/v1/events/event-1");

    await expect(authenticateApiRead(request, "event-1")).resolves.toEqual(auth);
    expect(authMocks.authenticateExternalRequest).toHaveBeenCalledWith(request, "event-1");
    expect(authMocks.requireExternalScope).toHaveBeenCalledWith(auth, "read", "event-1");
  });

  it("normalizes credential failures without exposing internal credential codes", async () => {
    const request = new Request("https://greenroom.test/api/v1/events");
    const response = await withApiRequest(request, async () => {
      throw new ExternalAuthError(401, "inactive_credential_owner", "Credential inactive.");
    });
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.error).toMatchObject({ code: "unauthorized", message: "Credential inactive." });
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("includes Retry-After on rate-limit errors", async () => {
    const response = await withApiRequest(
      new Request("https://greenroom.test/api/v1/events"),
      async () => {
        throw new ExternalAuthError(429, "rate_limited", "Too many requests.", {
          retryAfter: 60,
        });
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("does not expose unexpected exception details", async () => {
    const response = await withApiRequest(
      new Request("https://greenroom.test/api/v1/events"),
      async () => {
        throw new Error("private database detail");
      },
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database detail");
  });

  it("formats explicit route errors consistently", async () => {
    const response = await withApiRequest(
      new Request("https://greenroom.test/api/v1/events/missing"),
      async () => {
        throw new ApiError(404, "not_found", "Event not found.");
      },
    );

    expect(await response.json()).toMatchObject({
      error: { code: "not_found", message: "Event not found." },
    });
  });
});
