/**
 * Helpers for the OAuth consent screen (src/app/oauth/consent/page.tsx).
 *
 * These live outside the page so the failure classification can be unit-tested
 * without standing up Better Auth: the bug this file exists to prevent was a
 * blanket `catch { notFound() }` that turned *every* lookup failure into a 404,
 * including the one that fires for every MCP client we invite to self-register.
 */

/** The subset of better-call's APIError we can rely on across versions. */
interface ApiErrorShape {
  status?: unknown;
  statusCode?: unknown;
}

function readError(error: unknown): ApiErrorShape | null {
  if (typeof error !== "object" || error === null) return null;
  return error as ApiErrorShape;
}

/**
 * Whether a client lookup failed because the client genuinely does not exist,
 * as opposed to failing for any other reason.
 *
 * Only this case may become a 404. Everything else — a transport error, a
 * schema mismatch, an authorization rule we did not anticipate — has to stay
 * loud, because a silent 404 here is indistinguishable from "no such client"
 * and that ambiguity is exactly what hid the ownerless-client bug.
 */
export function isClientNotFoundError(error: unknown): boolean {
  const shape = readError(error);
  if (!shape) return false;
  if (shape.statusCode === 404) return true;
  return shape.status === "NOT_FOUND" || shape.status === 404;
}

/**
 * Scopes the consent screen is allowed to display and forward, in the order we
 * want them shown. Anything the client asks for beyond this set is dropped
 * rather than rendered, so the screen can never describe access that
 * `finishConsent` would go on to reject.
 */
export const CONSENT_SCOPES = ["greenroom:read", "greenroom:write", "offline_access"] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

const CONSENT_SCOPE_SET = new Set<string>(CONSENT_SCOPES);

export function isConsentScope(value: string): value is ConsentScope {
  return CONSENT_SCOPE_SET.has(value);
}

/**
 * Splits a raw `scope` parameter into the scopes we are willing to show.
 * Whitespace-separated per RFC 6749; unknown scopes are discarded, duplicates
 * collapse, and the result keeps CONSENT_SCOPES order so the screen reads the
 * same way regardless of how the client ordered its request.
 */
export function parseConsentScopes(scope: string | undefined): ConsentScope[] {
  const requested = new Set((scope ?? "").split(/\s+/).filter(isConsentScope));
  return CONSENT_SCOPES.filter((value) => requested.has(value));
}

export const CONSENT_SCOPE_DESCRIPTION: Record<ConsentScope, string> = {
  "greenroom:read": "Read events, sessions, speakers, submissions, and configuration",
  "greenroom:write": "Read and change event sessions, speakers, scheduling, and decisions",
  offline_access: "Stay connected without asking you to sign in again",
};
