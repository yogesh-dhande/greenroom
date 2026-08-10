import { getCloudflareContext } from "@opennextjs/cloudflare";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { getAuth } from "@/lib/auth";
import { getRepos } from "@/lib/db";

export type ExternalPermission = "read" | "write";
export type ExternalTokenType = "api_key" | "oauth";

export interface ExternalAuthContext {
  credentialId: string;
  ownerId: string;
  permission: ExternalPermission;
  eventScope: "all" | string[];
  tokenType: ExternalTokenType;
}

export class ExternalAuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 429,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ExternalAuthError";
  }
}

interface CredentialMetadata {
  eventAccess?: "all" | "selected";
  eventIds?: string[];
}

interface CredentialPermissions {
  greenroom?: string[];
}

/**
 * Authenticates either a Greenroom API key or an OAuth 2.1 access token.
 * Raw credentials never leave this function and are never included in an
 * error, log line, response body, or rate-limit key.
 */
export async function authenticateExternalRequest(
  request: Request,
  eventId?: string,
): Promise<ExternalAuthContext> {
  const token = credentialFromRequest(request);
  if (!token) {
    throw new ExternalAuthError(
      401,
      "unauthorized",
      "Provide an API key or OAuth bearer token.",
    );
  }

  const auth = await getAuth();
  const repos = await getRepos();
  let context: ExternalAuthContext;

  if (token.kind === "api_key") {
    const result = await auth.api.verifyApiKey({ body: { key: token.value } });
    if (!result.valid || !result.key) {
      throw new ExternalAuthError(401, "invalid_credential", "The API key is invalid or expired.");
    }

    const permissions = (result.key.permissions ?? {}) as CredentialPermissions;
    const actions = permissions.greenroom ?? [];
    const metadata = (result.key.metadata ?? {}) as CredentialMetadata;
    context = {
      credentialId: result.key.id,
      ownerId: result.key.referenceId,
      permission: actions.includes("write") ? "write" : "read",
      eventScope:
        metadata.eventAccess === "selected" && Array.isArray(metadata.eventIds)
          ? metadata.eventIds
          : "all",
      tokenType: "api_key",
    };
  } else {
    const audience = resourceAudience(request);
    let claims: { sub?: string; scope?: unknown };
    try {
      claims = await oauthProviderResourceClient(auth)
        .getActions()
        .verifyAccessToken(token.value, {
          verifyOptions: { audience },
        });
    } catch {
      throw new ExternalAuthError(
        401,
        "invalid_credential",
        "The OAuth access token is invalid or expired.",
      );
    }

    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      throw new ExternalAuthError(401, "invalid_credential", "The OAuth token has no owner.");
    }
    const scopes = oauthScopes(claims.scope);
    if (!scopes.has("greenroom:read") && !scopes.has("greenroom:write")) {
      throw new ExternalAuthError(403, "insufficient_scope", "The token has no Greenroom scope.");
    }

    context = {
      credentialId: `oauth:${await digestCredential(token.value)}`,
      ownerId: claims.sub,
      permission: scopes.has("greenroom:write") ? "write" : "read",
      eventScope: "all",
      tokenType: "oauth",
    };
  }

  // External access is a capability held by an administrator, not a durable
  // role grant: demotion disables every outstanding key/token immediately.
  const owner = await repos.users.getById(context.ownerId);
  if (!owner || owner.role !== "admin") {
    throw new ExternalAuthError(401, "inactive_credential_owner", "The credential is no longer active.");
  }

  enforceEventScope(context, eventId);
  await enforceExternalRateLimit(context.credentialId);
  return context;
}

export function requireExternalScope(
  context: ExternalAuthContext,
  required: ExternalPermission,
  eventId?: string,
): void {
  enforceEventScope(context, eventId);
  if (required === "write" && context.permission !== "write") {
    throw new ExternalAuthError(
      403,
      "insufficient_scope",
      "This credential does not allow writes.",
    );
  }
}

export function enforceEventScope(context: ExternalAuthContext, eventId?: string): void {
  if (!eventId || context.eventScope === "all") return;
  if (!context.eventScope.includes(eventId)) {
    // Conceal whether an event outside the credential's allowlist exists.
    throw new ExternalAuthError(404, "not_found", "Event not found.");
  }
}

export function credentialFromRequest(
  request: Request,
): { kind: ExternalTokenType; value: string } | null {
  const direct = request.headers.get("x-api-key")?.trim();
  if (direct) {
    return direct.startsWith("gr_") ? { kind: "api_key", value: direct } : null;
  }

  const match = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  return {
    kind: match[1].startsWith("gr_") ? "api_key" : "oauth",
    value: match[1],
  };
}

function resourceAudience(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}${url.pathname.startsWith("/mcp") ? "/mcp" : "/api/v1"}`;
}

function oauthScopes(value: unknown): Set<string> {
  if (typeof value === "string") return new Set(value.split(/\s+/).filter(Boolean));
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  return new Set();
}

async function digestCredential(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceExternalRateLimit(credentialId: string): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const limiter = (env as CloudflareEnv & { API_RATE_LIMITER?: RateLimit }).API_RATE_LIMITER;
  // The binding exists in deployed environments. Keeping this optional makes
  // direct unit tests and plain `next dev` usable without emulating it.
  if (!limiter) return;
  const outcome = await limiter.limit({ key: credentialId });
  if (!outcome.success) {
    throw new ExternalAuthError(429, "rate_limited", "Too many requests.", {
      retryAfter: 60,
    });
  }
}
