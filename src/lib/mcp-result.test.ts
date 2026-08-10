import { describe, expect, it } from "vitest";
import { McpOperationError } from "@/lib/mcp-runtime";
import {
  mcpErrorEnvelope,
  shapeMcpResource,
  shapeMcpToolError,
  shapeMcpToolSuccess,
} from "@/lib/mcp-result";

describe("MCP result shaping", () => {
  it("preserves a REST collection envelope as typed structuredContent", () => {
    const envelope = {
      data: [{ id: "session-1", title: "Keynote" }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    };

    expect(shapeMcpToolSuccess({ envelope })).toEqual({
      content: [{ type: "text", text: "Returned 1 record." }],
      structuredContent: envelope,
    });
  });

  it("uses a concise supplied summary without copying private DTO fields into text", () => {
    const result = shapeMcpToolSuccess({
      envelope: { data: { id: "speaker-1", email: "speaker@example.test", notes: "private" } },
      summary: "Retrieved speaker Ada.",
    });

    expect(result.content).toEqual([{ type: "text", text: "Retrieved speaker Ada." }]);
    expect(result.structuredContent).toEqual({
      data: { id: "speaker-1", email: "speaker@example.test", notes: "private" },
    });
  });

  it("returns expected application failures in-band with the REST error envelope", () => {
    const result = shapeMcpToolError(
      new McpOperationError(409, "conflict", "The placement overlaps another session.", {
        conflicts: ["session-2"],
      }),
      "request-1",
    );

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "The placement overlaps another session." }],
      structuredContent: {
        error: {
          code: "conflict",
          message: "The placement overlaps another session.",
          details: { conflicts: ["session-2"] },
          requestId: "request-1",
        },
      },
    });
  });

  it("redacts unexpected thrown values", () => {
    expect(mcpErrorEnvelope(new Error("database password leaked"), "request-2")).toEqual({
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
        requestId: "request-2",
      },
    });
  });

  it("renders resources as private JSON DTO envelopes", () => {
    const shaped = shapeMcpResource(
      { envelope: { data: { id: "event-1", timezone: "America/Los_Angeles" } } },
      "greenroom://events/event-1",
    );

    expect(shaped).toMatchObject({
      ttlMs: 0,
      cacheScope: "private",
      contents: [
        {
          uri: "greenroom://events/event-1",
          mimeType: "application/json",
          text: JSON.stringify({ data: { id: "event-1", timezone: "America/Los_Angeles" } }),
        },
      ],
    });
  });
});
