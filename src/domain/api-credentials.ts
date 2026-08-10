import { z } from "zod";
import {
  apiCredentialEventAccessSchema,
  apiCredentialPermissionSchema,
  type ApiCredential,
  type ApiCredentialPermission,
  type User,
} from "@/db/entities";
import type { ApiCredentialsRepo } from "@/db/repos/api-credentials";
import type { UsersRepo } from "@/db/repos/users";

export const API_KEY_PREFIX = "gr_";
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const;
export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS)[number];
export const DEFAULT_API_KEY_EXPIRY_DAYS: ApiKeyExpiryDays = 90;

const DAY_MS = 24 * 60 * 60 * 1_000;

const createInputSchema = z
  .object({
    ownerUserId: z.string().min(1),
    label: z.string().trim().min(1).max(80),
    permission: apiCredentialPermissionSchema,
    eventAccess: apiCredentialEventAccessSchema,
    eventIds: z.array(z.string().min(1)).default([]),
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90),
  })
  .superRefine((value, context) => {
    if (value.eventAccess === "selected" && value.eventIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["eventIds"],
        message: "Choose at least one event",
      });
    }
  });

export type CreateApiCredentialInput = z.input<typeof createInputSchema>;

/** SHA-256/base64url, byte-for-byte compatible with Better Auth's key plugin. */
export async function hashApiKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generates 384 bits of entropy. Forty-eight random bytes encode to exactly
 * 64 base64url characters, matching Better Auth's configured key length; the
 * visible `gr_` marker is not part of that entropy budget.
 */
export function generateApiKeySecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const binary = String.fromCharCode(...bytes);
  const random = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${API_KEY_PREFIX}${random}`;
}

/** Creates, hashes and persists a key; the raw secret exists only in this result. */
export async function createApiCredential(
  repo: ApiCredentialsRepo,
  rawInput: CreateApiCredentialInput,
  now: Date = new Date(),
): Promise<{ credential: ApiCredential; secret: string }> {
  const input = createInputSchema.parse(rawInput);
  const eventIds = input.eventAccess === "all" ? [] : [...new Set(input.eventIds)];
  const secret = generateApiKeySecret();
  const credential = await repo.create({
    ownerUserId: input.ownerUserId,
    label: input.label,
    keyPrefix: secret.slice(0, 11),
    secretHash: await hashApiKey(secret),
    permission: input.permission,
    eventAccess: input.eventAccess,
    eventIds,
    expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
  });
  return { credential, secret };
}

export class ApiCredentialNotFoundError extends Error {
  constructor() {
    super("API credential not found");
    this.name = "ApiCredentialNotFoundError";
  }
}

/** Ownership is checked here so one admin cannot revoke another's key by id. */
export async function revokeApiCredential(
  repo: ApiCredentialsRepo,
  credentialId: string,
  ownerUserId: string,
): Promise<void> {
  const credential = await repo.getById(credentialId);
  if (!credential || credential.ownerUserId !== ownerUserId) {
    throw new ApiCredentialNotFoundError();
  }
  await repo.revoke(credential.id);
}

/** Write permission is intentionally a strict superset of read permission. */
export function hasApiCredentialPermission(
  granted: ApiCredentialPermission,
  required: ApiCredentialPermission,
): boolean {
  return required === "read" || granted === "write";
}

/** Fixed allowlists conceal all other event ids; `all` includes future events. */
export function apiCredentialCanAccessEvent(
  credential: Pick<ApiCredential, "eventAccess" | "eventIds">,
  eventId: string,
): boolean {
  return credential.eventAccess === "all" || credential.eventIds.includes(eventId);
}

export type ApiCredentialAuthorizationFailure = {
  ok: false;
  status: 401 | 403 | 404;
  code:
    | "invalid_credential"
    | "inactive_credential_owner"
    | "insufficient_scope"
    | "not_found";
};

export type ApiCredentialAuthorizationResult =
  | { ok: true; credential: ApiCredential; owner: User }
  | ApiCredentialAuthorizationFailure;

export interface ApiCredentialAuthorizationRequest {
  requiredPermission?: ApiCredentialPermission;
  eventId?: string;
  now?: Date;
}

/**
 * Pure authorization decision once key lookup and owner lookup have run.
 * Event denial deliberately precedes permission denial so an out-of-allowlist
 * resource always has 404 semantics, including on attempted writes.
 */
export function authorizeApiCredential(
  credential: ApiCredential,
  owner: User | null,
  request: ApiCredentialAuthorizationRequest = {},
): ApiCredentialAuthorizationResult {
  const now = request.now ?? new Date();
  if (credential.revoked || credential.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 401, code: "invalid_credential" };
  }
  if (!owner || owner.id !== credential.ownerUserId || owner.role !== "admin") {
    return { ok: false, status: 401, code: "inactive_credential_owner" };
  }
  if (request.eventId && !apiCredentialCanAccessEvent(credential, request.eventId)) {
    return { ok: false, status: 404, code: "not_found" };
  }
  if (
    request.requiredPermission &&
    !hasApiCredentialPermission(credential.permission, request.requiredPermission)
  ) {
    return { ok: false, status: 403, code: "insufficient_scope" };
  }
  return { ok: true, credential, owner };
}

/**
 * Full storage-agnostic request check for consumers that do not use Better
 * Auth's verifier directly. The owner row is loaded every time, so demotion
 * disables an outstanding key immediately. Last-used advances only after all
 * authorization checks pass.
 */
export async function authenticateApiCredential(
  repos: { apiCredentials: ApiCredentialsRepo; users: UsersRepo },
  secret: string,
  request: ApiCredentialAuthorizationRequest = {},
): Promise<ApiCredentialAuthorizationResult> {
  if (!secret.startsWith(API_KEY_PREFIX)) {
    return { ok: false, status: 401, code: "invalid_credential" };
  }
  const credential = await repos.apiCredentials.getBySecretHash(await hashApiKey(secret));
  if (!credential) return { ok: false, status: 401, code: "invalid_credential" };

  // This lookup must not be memoized across requests: the admin role is a
  // revocable part of the capability.
  const owner = await repos.users.getById(credential.ownerUserId);
  const result = authorizeApiCredential(credential, owner, request);
  if (result.ok) {
    await repos.apiCredentials.setLastUsed(credential.id, request.now ?? new Date());
  }
  return result;
}
