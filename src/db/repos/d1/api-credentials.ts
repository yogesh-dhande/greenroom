import { desc, eq } from "drizzle-orm";
import {
  apiCredentialEventAccessSchema,
  apiCredentialSchema,
  newApiCredentialSchema,
  type ApiCredential,
  type ApiCredentialPermission,
} from "@/db/entities";
import type { ApiCredentialsRepo } from "@/db/repos/api-credentials";
import { apiCredentials } from "@/db/schema";
import type { DrizzleD1 } from "./client";

const permissionsSchema = {
  read: JSON.stringify({ greenroom: ["read"] }),
  write: JSON.stringify({ greenroom: ["read", "write"] }),
} satisfies Record<ApiCredentialPermission, string>;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    // Tolerate the double-stringified metadata written by older versions of
    // the Better Auth plugin, without ever mutating it during a read.
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

function permissionFrom(value: unknown): ApiCredentialPermission {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object") return "read";
  const actions = (parsed as Record<string, unknown>).greenroom;
  return Array.isArray(actions) && actions.includes("write") ? "write" : "read";
}

function metadataFrom(value: unknown): {
  eventAccess: "all" | "selected";
  eventIds: string[];
} {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object") {
    // Missing or malformed allowlist metadata fails closed.
    return { eventAccess: "selected", eventIds: [] };
  }
  const record = parsed as Record<string, unknown>;
  const access = apiCredentialEventAccessSchema.safeParse(record.eventAccess);
  const ids = Array.isArray(record.eventIds)
    ? [...new Set(record.eventIds.filter((id): id is string => typeof id === "string"))]
    : [];
  if (!access.success) return { eventAccess: "selected", eventIds: [] };
  return {
    eventAccess: access.data,
    eventIds: access.data === "all" ? [] : ids,
  };
}

function toEntity(row: typeof apiCredentials.$inferSelect): ApiCredential {
  const metadata = metadataFrom(row.metadata);
  return apiCredentialSchema.parse({
    id: row.id,
    ownerUserId: row.referenceId,
    label: row.name,
    keyPrefix: row.start ?? row.prefix,
    permission: permissionFrom(row.permissions),
    ...metadata,
    expiresAt: row.expiresAt,
    revoked: !row.enabled,
    lastUsedAt: row.lastRequest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function createApiCredentialsRepo(db: DrizzleD1): ApiCredentialsRepo {
  return {
    async getById(id) {
      const row = await db.query.apiCredentials.findFirst({
        where: eq(apiCredentials.id, id),
      });
      return row ? toEntity(row) : null;
    },

    async getBySecretHash(secretHash) {
      const row = await db.query.apiCredentials.findFirst({
        where: eq(apiCredentials.key, secretHash),
      });
      return row ? toEntity(row) : null;
    },

    async listByOwnerId(ownerUserId) {
      const rows = await db.query.apiCredentials.findMany({
        where: eq(apiCredentials.referenceId, ownerUserId),
        orderBy: [desc(apiCredentials.createdAt), desc(apiCredentials.id)],
      });
      return rows.map(toEntity);
    },

    async create(rawInput) {
      const input = newApiCredentialSchema.parse(rawInput);
      const [row] = await db
        .insert(apiCredentials)
        .values({
          configId: "default",
          name: input.label,
          start: input.keyPrefix,
          referenceId: input.ownerUserId,
          prefix: "gr_",
          key: input.secretHash,
          enabled: true,
          rateLimitEnabled: false,
          requestCount: 0,
          expiresAt: input.expiresAt,
          permissions: permissionsSchema[input.permission],
          metadata: JSON.stringify({
            eventAccess: input.eventAccess,
            eventIds: input.eventAccess === "all" ? [] : input.eventIds,
          }),
        })
        .returning();
      return toEntity(row);
    },

    async setLastUsed(id, at) {
      await db
        .update(apiCredentials)
        .set({ lastRequest: at, updatedAt: at })
        .where(eq(apiCredentials.id, id));
    },

    async revoke(id) {
      await db
        .update(apiCredentials)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(apiCredentials.id, id));
    },
  };
}
