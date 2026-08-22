import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_ENDPOINTS } from "@/lib/agent-discovery";

/**
 * Route-level cover for the agent/crawler discovery surface added after the
 * 2026-08-18 evaluator run, where `/openapi.json`, `/docs`, `/llms.txt` and
 * `/.well-known/mcp.json` were all 404s while the real endpoints existed one
 * segment away.
 *
 * These live together rather than as four near-empty files beside four
 * single-function routes; they are one feature.
 */

const redirects = vi.hoisted(() => ({ permanentRedirect: vi.fn() }));
vi.mock("next/navigation", () => redirects);

const BASE = "https://greenroom.example";
vi.mock("@/lib/public-url", () => ({ publicBaseUrl: async () => BASE }));

import { GET as getDocs } from "./docs/route";
import { GET as getOpenApi } from "./openapi.json/route";
import { GET as getLlms } from "./llms.txt/route";
import { GET as getMcpDescriptor } from "./.well-known/mcp.json/route";

beforeEach(() => {
  redirects.permanentRedirect.mockReset();
});

describe("root-level aliases", () => {
  it("/openapi.json permanently redirects to the versioned document", () => {
    getOpenApi();
    // Permanent, and to the versioned path: the /api/v1 document stays the one
    // source rather than being copied to a second URL that can drift.
    expect(redirects.permanentRedirect).toHaveBeenCalledWith(AGENT_ENDPOINTS.openapi);
    expect(AGENT_ENDPOINTS.openapi).toBe("/api/v1/openapi.json");
  });

  it("/docs permanently redirects to the API reference", () => {
    getDocs();
    expect(redirects.permanentRedirect).toHaveBeenCalledWith(AGENT_ENDPOINTS.docs);
    expect(AGENT_ENDPOINTS.docs).toBe("/api/docs");
  });
});

describe("/llms.txt", () => {
  it("serves plain text built from the deployment's own origin", async () => {
    const response = await getLlms();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain(`${BASE}${AGENT_ENDPOINTS.openapi}`);
    expect(body).toContain(`${BASE}${AGENT_ENDPOINTS.mcp}`);
  });
});

describe("/.well-known/mcp.json", () => {
  it("serves a JSON descriptor pointing at the real MCP endpoint", async () => {
    const response = await getMcpDescriptor();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { endpoint: string; transport: { methods: string[] } };
    expect(body.endpoint).toBe(`${BASE}${AGENT_ENDPOINTS.mcp}`);
    expect(body.transport.methods).toEqual(["POST"]);
  });
});
