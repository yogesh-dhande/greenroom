import { describe, expect, it } from "vitest";
import {
  CONSENT_SCOPE_DESCRIPTION,
  CONSENT_SCOPES,
  isClientNotFoundError,
  isConsentScope,
  parseConsentScopes,
} from "./oauth-consent";

/**
 * Regression cover for the failure that took the whole OAuth/MCP surface down
 * on 2026-08-18: the consent screen caught every client-lookup error and
 * answered 404, so an authorization failure on a self-registered MCP client was
 * indistinguishable from "no such client" and the flow simply dead-ended.
 */
describe("isClientNotFoundError", () => {
  it("recognises a genuine not-found by numeric status code", () => {
    expect(isClientNotFoundError({ status: "NOT_FOUND", statusCode: 404 })).toBe(true);
  });

  it("recognises a not-found reported only as a status name or number", () => {
    expect(isClientNotFoundError({ status: "NOT_FOUND" })).toBe(true);
    expect(isClientNotFoundError({ status: 404 })).toBe(true);
  });

  it("does NOT treat an authorization failure as a missing client", () => {
    // This is the exact shape better-auth throws for a client whose userId and
    // referenceId are both null — every client created through unauthenticated
    // dynamic registration. Reporting it as 404 is what hid the bug.
    expect(isClientNotFoundError({ status: "UNAUTHORIZED", statusCode: 401 })).toBe(false);
  });

  it("does not treat server or transport failures as a missing client", () => {
    expect(isClientNotFoundError({ status: "INTERNAL_SERVER_ERROR", statusCode: 500 })).toBe(false);
    expect(isClientNotFoundError(new Error("connection reset"))).toBe(false);
  });

  it("is safe on values that are not errors at all", () => {
    expect(isClientNotFoundError(null)).toBe(false);
    expect(isClientNotFoundError(undefined)).toBe(false);
    expect(isClientNotFoundError("NOT_FOUND")).toBe(false);
    expect(isClientNotFoundError(404)).toBe(false);
  });
});

describe("parseConsentScopes", () => {
  it("keeps only scopes the consent action will actually accept", () => {
    expect(parseConsentScopes("greenroom:read admin:everything")).toEqual(["greenroom:read"]);
  });

  it("includes offline_access, which the old startsWith filter silently dropped", () => {
    // The screen used to filter on `startsWith("greenroom:")`, so a client
    // asking for a refresh token was granted one without it ever being shown.
    expect(parseConsentScopes("greenroom:read offline_access")).toEqual([
      "greenroom:read",
      "offline_access",
    ]);
  });

  it("normalises order and duplicates so the screen reads the same either way", () => {
    expect(parseConsentScopes("offline_access greenroom:write greenroom:read")).toEqual([
      "greenroom:read",
      "greenroom:write",
      "offline_access",
    ]);
    expect(parseConsentScopes("greenroom:read greenroom:read")).toEqual(["greenroom:read"]);
  });

  it("tolerates irregular whitespace and empty input", () => {
    expect(parseConsentScopes("  greenroom:read \t greenroom:write ")).toEqual([
      "greenroom:read",
      "greenroom:write",
    ]);
    expect(parseConsentScopes("")).toEqual([]);
    expect(parseConsentScopes(undefined)).toEqual([]);
  });

  it("describes every scope it is willing to display", () => {
    for (const scope of CONSENT_SCOPES) {
      expect(isConsentScope(scope)).toBe(true);
      expect(CONSENT_SCOPE_DESCRIPTION[scope]).toBeTruthy();
    }
  });
});
