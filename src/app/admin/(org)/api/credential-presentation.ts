import type { ApiCredential } from "@/db/entities";
import type { ApiCredentialRow } from "./types";

/** Maps the domain entity to the deliberately smaller, serializable UI DTO. */
export function toApiCredentialRow(credential: ApiCredential): ApiCredentialRow {
  return {
    id: credential.id,
    label: credential.label,
    prefix: credential.keyPrefix,
    permission: credential.permission,
    eventAccess: credential.eventAccess,
    eventIds: [...credential.eventIds],
    createdAt: credential.createdAt.toISOString(),
    expiresAt: credential.expiresAt.toISOString(),
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
  };
}
