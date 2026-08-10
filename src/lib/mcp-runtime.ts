/**
 * Application-facing seam for the remote MCP adapter.
 *
 * The MCP transport deliberately knows nothing about D1, Drizzle, Better Auth,
 * or the UI's server actions. The production composition authenticates a
 * credential and delegates these calls to the same storage-agnostic services
 * used by REST and the organizer UI. Tests can supply a small in-memory
 * implementation without mocking the protocol SDK.
 */

export type McpPermission = "read" | "write";

export interface McpPrincipal {
  userId: string;
  credentialId: string;
  /** OAuth spelling (`greenroom:*`) is canonical; short spellings ease API-key adapters. */
  scopes: string[];
  /** Undefined means all current and future events. */
  eventIds?: string[];
}

export type McpRestEnvelope =
  | { data: unknown }
  | {
      data: unknown[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    };

export interface McpOperationResult {
  /** The exact DTO envelope exposed by the corresponding REST operation. */
  envelope: McpRestEnvelope;
  /** A short, non-sensitive sentence for clients that only render text content. */
  summary?: string;
}

export interface McpExecutionContext {
  principal: McpPrincipal;
  requestId: string;
}

export type McpAuthenticationResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; response: Response };

export interface GreenroomMcpRuntime {
  authenticate(request: Request): Promise<McpAuthenticationResult>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    context: McpExecutionContext,
  ): Promise<McpOperationResult>;
  readResource(uri: string, context: McpExecutionContext): Promise<McpOperationResult>;
}

export type McpOperationErrorStatus = 400 | 403 | 404 | 409 | 429 | 500 | 503;

/** A safe, transport-neutral application error suitable for MCP structured content. */
export class McpOperationError extends Error {
  constructor(
    readonly status: McpOperationErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "McpOperationError";
  }
}

export function hasMcpPermission(principal: McpPrincipal, permission: McpPermission): boolean {
  const scopes = new Set(principal.scopes);
  const canWrite = scopes.has("greenroom:write") || scopes.has("write");
  if (permission === "write") return canWrite;
  return canWrite || scopes.has("greenroom:read") || scopes.has("read");
}

/**
 * Safe placeholder until the auth/service composition is injected by the
 * external-auth integration. An absent credential still gets the OAuth
 * discovery challenge; a presented credential is never guessed or accepted.
 */
export const unconfiguredMcpRuntime: GreenroomMcpRuntime = {
  async authenticate(request) {
    const hasCredential =
      Boolean(request.headers.get("authorization")) || Boolean(request.headers.get("x-api-key"));
    if (hasCredential) {
      return {
        ok: false,
        response: Response.json(
          { error: "server_error", error_description: "MCP authentication is unavailable." },
          { status: 500 },
        ),
      };
    }
    return {
      ok: false,
      response: Response.json(
        { error: "invalid_token", error_description: "Authentication is required." },
        { status: 401 },
      ),
    };
  },
  async callTool() {
    throw new McpOperationError(503, "unavailable", "MCP services are unavailable.");
  },
  async readResource() {
    throw new McpOperationError(503, "unavailable", "MCP services are unavailable.");
  },
};
