import type { Repos } from "@/db/repos";
import {
  createApiCredential as createCredential,
  revokeApiCredential as revokeCredential,
} from "@/domain/api-credentials";
import { getRepos } from "@/lib/db";
import { toApiCredentialRow } from "./credential-presentation";
import type {
  ApiCredentialRow,
  ApiEventOption,
  CreateApiCredentialInput,
} from "./types";

/**
 * The admin page's application-service boundary. Server actions and the page
 * depend on this shape rather than reaching into a datastore or auth plugin.
 * The concrete adapter below composes the storage-agnostic repos with the
 * shared credential domain workflows used by REST/MCP authentication.
 */
export interface ApiCredentialAdminService {
  listEvents(): Promise<ApiEventOption[]>;
  listCredentials(ownerUserId: string): Promise<ApiCredentialRow[]>;
  createCredential(
    ownerUserId: string,
    input: CreateApiCredentialInput,
  ): Promise<{ credential: ApiCredentialRow; secret: string }>;
  revokeCredential(ownerUserId: string, credentialId: string): Promise<void>;
}

export function createApiCredentialAdminService(repos: Repos): ApiCredentialAdminService {
  return {
    async listEvents() {
      const events = await repos.events.listAll();
      return events.map(({ id, name, slug }) => ({ id, name, slug }));
    },

    async listCredentials(ownerUserId) {
      const credentials = await repos.apiCredentials.listByOwnerId(ownerUserId);
      return credentials.filter((credential) => !credential.revoked).map(toApiCredentialRow);
    },

    async createCredential(ownerUserId, input) {
      // Re-check selected ids against the current event list. The browser's
      // checkboxes are presentation, not authorization or validation.
      if (input.eventAccess === "selected") {
        const allowedIds = new Set((await repos.events.listAll()).map((event) => event.id));
        if (input.eventIds.some((eventId) => !allowedIds.has(eventId))) {
          throw new Error("One of the selected events no longer exists — refresh and try again");
        }
      }

      const result = await createCredential(repos.apiCredentials, {
        ownerUserId,
        label: input.label,
        permission: input.permission,
        eventAccess: input.eventAccess,
        eventIds: input.eventAccess === "selected" ? input.eventIds : [],
        expiresInDays: input.expiresInDays,
      });
      return { credential: toApiCredentialRow(result.credential), secret: result.secret };
    },

    async revokeCredential(ownerUserId, credentialId) {
      await revokeCredential(repos.apiCredentials, credentialId, ownerUserId);
    },
  };
}

export async function getApiCredentialAdminService(): Promise<ApiCredentialAdminService> {
  return createApiCredentialAdminService(await getRepos());
}
