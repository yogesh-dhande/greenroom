import { describe, expect, it, vi } from "vitest";
import { createGreenroomMcpPostHandler, MCP_ALLOWED_METHODS } from "@/lib/mcp-server";
import {
  DELETE as methodNotAllowedDelete,
  GET as methodNotAllowedGet,
  OPTIONS as optionsHandler,
} from "./route";
import {
  McpOperationError,
  type GreenroomMcpRuntime,
  type McpOperationResult,
} from "@/lib/mcp-runtime";

const principal = {
  userId: "admin-1",
  credentialId: "key-1",
  scopes: ["greenroom:read", "greenroom:write"],
};

function runtime(options: {
  callTool?: (name: string, args: Record<string, unknown>) => Promise<McpOperationResult>;
  readResource?: (uri: string) => Promise<McpOperationResult>;
} = {}): GreenroomMcpRuntime {
  return {
    authenticate: vi.fn(async () => ({ ok: true as const, principal })),
    callTool:
      options.callTool ??
      (async (name) => ({ envelope: { data: { operation: name } }, summary: `${name} complete.` })),
    readResource:
      options.readResource ??
      (async (uri) => ({ envelope: { data: { uri } }, summary: "Resource read." })),
  };
}

function mcpRequest(
  body: Record<string, unknown>,
  options: { modern?: boolean; origin?: string; host?: string } = {},
): Request {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    host: options.host ?? "greenroom.usespaces.dev",
  });
  if (options.origin) headers.set("origin", options.origin);
  if (options.modern) {
    const method = String(body.method);
    headers.set("mcp-protocol-version", "2026-07-28");
    headers.set("mcp-method", method);
    const params = body.params as Record<string, unknown> | undefined;
    if (method === "tools/call" && typeof params?.name === "string") {
      headers.set("mcp-name", params.name);
    }
    if (method === "resources/read" && typeof params?.uri === "string") {
      headers.set("mcp-name", params.uri);
    }
  }
  return new Request("https://greenroom.usespaces.dev/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function modernParams(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "greenroom-test", version: "1.0.0" },
    },
  };
}

interface TestProtocolBody extends Record<string, unknown> {
  result: Record<string, unknown> & {
    tools: Array<{ name: string; annotations?: Record<string, unknown> }>;
    resourceTemplates: Array<{ uriTemplate: string }>;
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  };
}

async function json(response: Response): Promise<TestProtocolBody> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const event = (await response.text())
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!event) throw new Error("MCP SSE response contained no data event");
    return JSON.parse(event.slice("data: ".length)) as TestProtocolBody;
  }
  return response.json() as Promise<TestProtocolBody>;
}

describe("POST /mcp", () => {
  it("supports the legacy stateless initialize handshake", async () => {
    const handler = createGreenroomMcpPostHandler(runtime());
    const response = await handler.POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1.0.0" },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "greenroom", version: "1.0.0" },
        capabilities: { tools: {}, resources: {} },
      },
    });
  });

  it("discovers the modern stateless server", async () => {
    const handler = createGreenroomMcpPostHandler(runtime());
    const response = await handler.POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 2, method: "server/discover", params: modernParams() },
        { modern: true },
      ),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      id: 2,
      result: {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {}, resources: {} },
      },
    });
  });

  it("lists the complete annotated tool catalog", async () => {
    const handler = createGreenroomMcpPostHandler(runtime());
    const response = await handler.POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 3, method: "tools/list", params: modernParams() },
        { modern: true },
      ),
    );
    const body = await json(response);
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "list_events",
        "get_event_configuration",
        "suggest_session_slot",
        "create_session",
        "place_session",
        "decide_submission",
      ]),
    );
    expect(names).toHaveLength(19);
    expect(body.result.tools.find((tool: { name: string }) => tool.name === "list_events"))
      .toMatchObject({ annotations: { readOnlyHint: true, destructiveHint: false } });
    expect(body.result.tools.find((tool: { name: string }) => tool.name === "decide_submission"))
      .toMatchObject({ annotations: { destructiveHint: true, openWorldHint: true } });
  });

  it("lists the event resource and event-scoped resource templates", async () => {
    const handler = createGreenroomMcpPostHandler(runtime());
    const resourcesResponse = await handler.POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 4, method: "resources/list", params: modernParams() },
        { modern: true },
      ),
    );
    const templatesResponse = await handler.POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 5, method: "resources/templates/list", params: modernParams() },
        { modern: true },
      ),
    );

    expect(await json(resourcesResponse)).toMatchObject({
      result: { resources: [{ uri: "greenroom://events", mimeType: "application/json" }] },
    });
    const templates = (await json(templatesResponse)).result.resourceTemplates;
    expect(templates.map((item: { uriTemplate: string }) => item.uriTemplate)).toEqual(
      expect.arrayContaining([
        "greenroom://events/{eventId}",
        "greenroom://events/{eventId}/agenda",
        "greenroom://events/{eventId}/sessions/{sessionId}",
        "greenroom://events/{eventId}/speakers/{speakerId}",
        "greenroom://events/{eventId}/submissions/{submissionId}",
      ]),
    );
  });

  it("reads an event-scoped resource as a JSON REST DTO envelope", async () => {
    const readResource = vi.fn(async () => ({
      envelope: { data: { id: "event-1", name: "AI Engineer World's Fair" } },
    }));
    const handler = createGreenroomMcpPostHandler(runtime({ readResource }));
    const response = await handler.POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 51,
          method: "resources/read",
          params: modernParams({ uri: "greenroom://events/event-1" }),
        },
        { modern: true },
      ),
    );
    const result = (await json(response)).result;

    expect(result.contents).toEqual([
      {
        uri: "greenroom://events/event-1",
        mimeType: "application/json",
        text: JSON.stringify({ data: { id: "event-1", name: "AI Engineer World's Fair" } }),
      },
    ]);
    expect(readResource).toHaveBeenCalledWith(
      "greenroom://events/event-1",
      expect.objectContaining({ principal, requestId: expect.any(String) }),
    );
  });

  it("returns REST DTO envelopes as typed structured tool content", async () => {
    const callTool = vi.fn(async () => ({
      envelope: {
        data: [
          {
            id: "event-1",
            name: "AI Engineer World's Fair",
            slug: "ai-engineer-worlds-fair",
            startDate: "2026-08-12",
            endDate: "2026-08-13",
            timezone: "America/Los_Angeles",
            location: "San Francisco",
            programPublished: true,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-10T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
      summary: "Returned one event.",
    }));
    const handler = createGreenroomMcpPostHandler(runtime({ callTool }));
    const response = await handler.POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: modernParams({ name: "list_events", arguments: {} }),
        },
        { modern: true },
      ),
    );
    const body = await json(response);

    expect(body.result).toMatchObject({
      content: [{ type: "text", text: "Returned one event." }],
      structuredContent: {
        data: [expect.objectContaining({ id: "event-1", name: "AI Engineer World's Fair" })],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
    });
    expect(callTool).toHaveBeenCalledWith(
      "list_events",
      { page: 1, pageSize: 25 },
      expect.objectContaining({ principal, requestId: expect.any(String) }),
    );
  });

  it("returns application errors as structured tool errors", async () => {
    const handler = createGreenroomMcpPostHandler(
      runtime({
        callTool: async () => {
          throw new McpOperationError(404, "not_found", "Session not found.");
        },
      }),
    );
    const response = await handler.POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: modernParams({
            name: "get_session",
            arguments: { eventId: "event-1", sessionId: "missing" },
          }),
        },
        { modern: true },
      ),
    );
    const body = await json(response);

    expect(body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Session not found." }],
      structuredContent: {
        error: { code: "not_found", message: "Session not found.", requestId: expect.any(String) },
      },
    });
  });

  it("rejects an untrusted browser Origin before authentication", async () => {
    const fakeRuntime = runtime();
    const handler = createGreenroomMcpPostHandler(fakeRuntime);
    const response = await handler.POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 8, method: "server/discover", params: modernParams() },
        { modern: true, origin: "https://attacker.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect(fakeRuntime.authenticate).not.toHaveBeenCalled();
  });

  it("rejects an untrusted Host before authentication", async () => {
    const fakeRuntime = runtime();
    const handler = createGreenroomMcpPostHandler(fakeRuntime);
    const response = await handler.POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 9, method: "server/discover", params: modernParams() },
        { modern: true, host: "attacker.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect(fakeRuntime.authenticate).not.toHaveBeenCalled();
  });

  it("adds RFC 9728 discovery to an authentication challenge", async () => {
    const fakeRuntime = runtime();
    fakeRuntime.authenticate = async () => ({
      ok: false,
      response: Response.json({ error: "invalid_token" }, { status: 401 }),
    });
    const response = await createGreenroomMcpPostHandler(fakeRuntime).POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 10, method: "server/discover", params: modernParams() },
        { modern: true },
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://greenroom.usespaces.dev/.well-known/oauth-protected-resource/mcp"',
    );
  });
});

/**
 * The rest of the Streamable HTTP method surface.
 *
 * The 2026-08-18 evaluator probed `GET /mcp` before `POST` and got Next.js's
 * own bare 405 — no `Allow` header, no body. From the client side that is
 * indistinguishable from a misrouted URL.
 *
 * 405 is the *correct* status: the spec says a Streamable HTTP server offering
 * no SSE stream on GET must answer 405, and this server is stateless with JSON
 * responses. What was missing was everything that makes the 405 readable.
 */
describe("the non-POST /mcp methods", () => {
  for (const [name, handler] of [
    ["GET", methodNotAllowedGet],
    ["DELETE", methodNotAllowedDelete],
  ] as const) {
    describe(name, () => {
      it("answers 405 with an Allow header naming POST", () => {
        const response = handler();
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe(MCP_ALLOWED_METHODS);
        expect(response.headers.get("allow")).toContain("POST");
      });

      it("answers with a JSON-RPC error body explaining the transport", async () => {
        const body = (await handler().json()) as {
          jsonrpc: string;
          id: null;
          error: { code: number; message: string; data: { allow: string[] } };
        };
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBeNull();
        expect(body.error.code).toBe(-32000);
        expect(body.error.message).toContain("POST");
        expect(body.error.data.allow).toEqual(["POST", "OPTIONS"]);
      });

      it("is never cached — the answer describes this deployment's transport", () => {
        expect(handler().headers.get("cache-control")).toBe("private, no-store");
      });
    });
  }

  it("answers OPTIONS with 204 and the same Allow header", () => {
    const response = optionsHandler();
    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe(MCP_ALLOWED_METHODS);
  });
});
