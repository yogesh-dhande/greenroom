/** Serializable view models shared by the API-key page and its client islands. */
export type ApiKeyPermission = "read" | "write";

export interface ApiEventOption {
  id: string;
  name: string;
  slug: string;
}

export interface ApiCredentialRow {
  id: string;
  label: string;
  prefix: string;
  permission: ApiKeyPermission;
  eventAccess: "all" | "selected";
  eventIds: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export interface CreateApiCredentialInput {
  label: string;
  permission: ApiKeyPermission;
  eventAccess: "all" | "selected";
  eventIds: string[];
  expiresInDays: 30 | 90 | 365;
}

export type CreateApiCredentialResult =
  | {
      ok: true;
      data: {
        credential: ApiCredentialRow;
        /** Returned by the server exactly once and never persisted in this form. */
        secret: string;
      };
    }
  | { ok: false; error: string };

export type RevokeApiCredentialResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };
