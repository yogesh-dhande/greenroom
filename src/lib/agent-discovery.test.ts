import { describe, expect, it } from "vitest";
import { AGENT_ENDPOINTS, AGENT_SCOPES, llmsTxt, mcpDescriptor } from "./agent-discovery";

const BASE = "https://greenroom.example";

/**
 * These documents exist because the 2026-08-18 evaluator spent its first
 * minutes collecting 404s from `/llms.txt`, `/openapi.json`, `/docs` and
 * `/.well-known/mcp.json` while the real surface sat one path segment away.
 * The assertions below are mostly "does it actually point at the real thing",
 * because a discovery document that names a wrong URL is worse than none.
 */
describe("llms.txt", () => {
  it("points at the real OpenAPI document, reference, and MCP endpoint", () => {
    const text = llmsTxt(BASE);
    expect(text).toContain(`${BASE}${AGENT_ENDPOINTS.openapi}`);
    expect(text).toContain(`${BASE}${AGENT_ENDPOINTS.docs}`);
    expect(text).toContain(`${BASE}${AGENT_ENDPOINTS.mcp}`);
  });

  it("names both OAuth metadata documents", () => {
    const text = llmsTxt(BASE);
    expect(text).toContain(`${BASE}${AGENT_ENDPOINTS.authorizationServerMetadata}`);
    expect(text).toContain(`${BASE}${AGENT_ENDPOINTS.protectedResourceMetadata}`);
  });

  it("states the MCP method surface, so a client does not read 405 as broken", () => {
    const text = llmsTxt(BASE);
    expect(text).toContain("POST only");
    expect(text).toContain("405");
  });

  it("lists every supported scope", () => {
    const text = llmsTxt(BASE);
    for (const scope of AGENT_SCOPES) expect(text).toContain(scope);
  });

  it("never emits a doubled slash from the base URL", () => {
    expect(llmsTxt(BASE)).not.toMatch(/[^:]\/\//);
  });
});

describe("mcp.json descriptor", () => {
  it("describes the transport this server actually implements", () => {
    const doc = mcpDescriptor(BASE);
    expect(doc.endpoint).toBe(`${BASE}${AGENT_ENDPOINTS.mcp}`);
    expect(doc.transport.type).toBe("streamable-http");
    // Stateless + JSON: advertising GET here would promise an SSE stream that
    // does not exist, which is the opposite of the problem being fixed.
    expect(doc.transport.methods).toEqual(["POST"]);
  });

  it("advertises dynamic client registration and the OAuth metadata", () => {
    const doc = mcpDescriptor(BASE);
    expect(doc.authorization.dynamicClientRegistration).toBe(true);
    expect(doc.authorization.authorizationServerMetadata).toBe(
      `${BASE}${AGENT_ENDPOINTS.authorizationServerMetadata}`,
    );
    expect(doc.authorization.protectedResourceMetadata).toBe(
      `${BASE}${AGENT_ENDPOINTS.protectedResourceMetadata}`,
    );
    expect(doc.authorization.scopes).toEqual([...AGENT_SCOPES]);
  });

  it("serialises to JSON without losing anything", () => {
    const doc = mcpDescriptor(BASE);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
