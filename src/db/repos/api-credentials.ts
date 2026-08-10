import type { ApiCredential, NewApiCredential } from "@/db/entities";

/**
 * Storage-agnostic API-key persistence. The secret digest is accepted only as
 * an opaque lookup/create value and is never returned on an entity.
 */
export interface ApiCredentialsRepo {
  getById(id: string): Promise<ApiCredential | null>;
  getBySecretHash(secretHash: string): Promise<ApiCredential | null>;
  listByOwnerId(ownerUserId: string): Promise<ApiCredential[]>;
  create(input: NewApiCredential): Promise<ApiCredential>;
  setLastUsed(id: string, at: Date): Promise<void>;
  /** Idempotently disables the credential. */
  revoke(id: string): Promise<void>;
}
