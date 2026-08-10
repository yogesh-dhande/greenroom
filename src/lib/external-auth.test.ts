import { describe, expect, it } from "vitest";
import {
  credentialFromRequest,
  enforceEventScope,
  ExternalAuthError,
  requireExternalScope,
  type ExternalAuthContext,
} from "./external-auth";

const base: ExternalAuthContext = {
  credentialId: "key-1",
  ownerId: "admin-1",
  permission: "read",
  eventScope: "all",
  tokenType: "api_key",
};

describe("external credential parsing", () => {
  it("accepts gr_ keys from the dedicated header or bearer auth", () => {
    expect(
      credentialFromRequest(
        new Request("https://greenroom.test/api/v1/events", {
          headers: { "x-api-key": "gr_secret" },
        }),
      ),
    ).toEqual({ kind: "api_key", value: "gr_secret" });
    expect(
      credentialFromRequest(
        new Request("https://greenroom.test/mcp", {
          headers: { authorization: "Bearer gr_secret" },
        }),
      ),
    ).toEqual({ kind: "api_key", value: "gr_secret" });
  });

  it("treats non-Greenroom bearer values as OAuth tokens", () => {
    expect(
      credentialFromRequest(
        new Request("https://greenroom.test/mcp", {
          headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig" },
        }),
      ),
    ).toEqual({ kind: "oauth", value: "eyJhbGciOiJSUzI1NiJ9.payload.sig" });
  });

  it("rejects malformed and non-prefixed dedicated keys", () => {
    expect(
      credentialFromRequest(
        new Request("https://greenroom.test/mcp", { headers: { "x-api-key": "secret" } }),
      ),
    ).toBeNull();
    expect(credentialFromRequest(new Request("https://greenroom.test/mcp"))).toBeNull();
  });
});

describe("external authorization", () => {
  it("lets write permission satisfy reads and writes", () => {
    const writable = { ...base, permission: "write" as const };
    expect(() => requireExternalScope(writable, "read")).not.toThrow();
    expect(() => requireExternalScope(writable, "write")).not.toThrow();
  });

  it("returns a scope error for a read-only write", () => {
    expect(() => requireExternalScope(base, "write")).toThrowError(
      expect.objectContaining({ status: 403, code: "insufficient_scope" }),
    );
  });

  it("conceals events outside a key allowlist with 404", () => {
    const restricted = { ...base, eventScope: ["event-a"] };
    expect(() => enforceEventScope(restricted, "event-a")).not.toThrow();
    try {
      enforceEventScope(restricted, "event-b");
      throw new Error("expected event denial");
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalAuthError);
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    }
  });
});
