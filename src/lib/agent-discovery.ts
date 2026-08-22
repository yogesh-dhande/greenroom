/**
 * Machine-readable descriptions of Greenroom's agent-facing surface.
 *
 * The 2026-08-18 evaluator went looking for all of this before it found the
 * real thing: `/openapi.json`, `/docs`, `/.well-known/mcp.json`, `/llms.txt`,
 * `/api`, `/health`. The REST API and its reference already existed at
 * `/api/v1/openapi.json` and `/api/docs`, but nothing at the conventional
 * locations pointed at them, so the first few minutes of the run were spent
 * collecting 404s.
 *
 * Content lives here rather than inline in the routes so it can be asserted on
 * without spinning up a request.
 */

/** Where each part of the agent surface lives, relative to the origin. */
export const AGENT_ENDPOINTS = {
  openapi: "/api/v1/openapi.json",
  docs: "/api/docs",
  restBase: "/api/v1",
  mcp: "/mcp",
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  protectedResourceMetadata: "/.well-known/oauth-protected-resource/mcp",
} as const;

export const AGENT_SCOPES = ["greenroom:read", "greenroom:write", "offline_access"] as const;

/**
 * `/llms.txt` — the plain-text orientation page an agent reads first.
 * Prose, not a schema: it says what Greenroom is, how to authenticate, and
 * which URL to read next for the machine-readable version.
 */
export function llmsTxt(base: string): string {
  return `# Greenroom

> Open-source event speaker and session management: call for speakers, abstract
> review, speaker portal, agenda building, and public program widgets.

Greenroom exposes two programmatic surfaces. Both are authenticated and both
enforce the same authorization rules as the web UI — an API caller can never
read or change anything the credential's owner could not.

## REST API

- OpenAPI 3.1 document: ${base}${AGENT_ENDPOINTS.openapi}
- Human-readable reference: ${base}${AGENT_ENDPOINTS.docs}
- Base path: ${base}${AGENT_ENDPOINTS.restBase}

Authenticate with either an API key or an OAuth 2.1 access token:

- API key: send \`Authorization: Bearer gr_...\` or \`X-API-Key: gr_...\`.
  Organizers create keys in the admin area under API.
- OAuth 2.1: see below. Access tokens are sent as \`Authorization: Bearer ...\`.

## MCP server

- Endpoint: ${base}${AGENT_ENDPOINTS.mcp}
- Transport: Streamable HTTP, stateless, JSON responses.
- Methods: POST only. There is no SSE stream on GET and no session to end with
  DELETE; both answer 405 with an \`Allow: POST\` header.

## OAuth 2.1

- Authorization server metadata: ${base}${AGENT_ENDPOINTS.authorizationServerMetadata}
- Protected resource metadata: ${base}${AGENT_ENDPOINTS.protectedResourceMetadata}
- Dynamic client registration is open; public clients use authorization code
  with PKCE (S256).
- Scopes: ${AGENT_SCOPES.join(", ")}.
- Granting consent requires signing in as a Greenroom administrator. A
  connection acts with that administrator's access.

## Public program

Each event publishes a program at ${base}/p/<event-slug> once its organizer has
published it, with /schedule, /speakers, and /gallery beneath it, plus
feed.ics, feed.json, and feed.xml. Embeddable versions live under
${base}/embed/<event-slug>/. These need no authentication.
`;
}

export interface McpDescriptor {
  name: string;
  description: string;
  version: string;
  endpoint: string;
  transport: { type: string; methods: string[] };
  authorization: {
    type: string;
    authorizationServerMetadata: string;
    protectedResourceMetadata: string;
    scopes: string[];
    dynamicClientRegistration: boolean;
  };
  documentation: string;
}

/**
 * `/.well-known/mcp.json`. Not a ratified part of the MCP specification — the
 * normative discovery path is the OAuth protected-resource metadata this
 * document points at — but enough clients and evaluators probe for it that
 * answering is cheaper than the 404. It states where the real endpoint and the
 * real metadata are, and claims nothing beyond that.
 */
export function mcpDescriptor(base: string): McpDescriptor {
  return {
    name: "greenroom",
    description: "Event speaker, session, review, and agenda management for conference organizers.",
    version: "1.0.0",
    endpoint: `${base}${AGENT_ENDPOINTS.mcp}`,
    transport: { type: "streamable-http", methods: ["POST"] },
    authorization: {
      type: "oauth2",
      authorizationServerMetadata: `${base}${AGENT_ENDPOINTS.authorizationServerMetadata}`,
      protectedResourceMetadata: `${base}${AGENT_ENDPOINTS.protectedResourceMetadata}`,
      scopes: [...AGENT_SCOPES],
      dynamicClientRegistration: true,
    },
    documentation: `${base}${AGENT_ENDPOINTS.docs}`,
  };
}
