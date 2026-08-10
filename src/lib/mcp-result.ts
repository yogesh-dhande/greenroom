import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/server";
import {
  McpOperationError,
  type McpOperationResult,
  type McpRestEnvelope,
} from "@/lib/mcp-runtime";

export interface McpErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

const API_ERROR_CODES = new Set([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
]);

function apiErrorCode(error: McpOperationError): string {
  if (API_ERROR_CODES.has(error.code)) return error.code;
  switch (error.status) {
    case 400:
      return "bad_request";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "internal_error";
  }
}

function countFromEnvelope(envelope: McpRestEnvelope): number | null {
  return Array.isArray(envelope.data) ? envelope.data.length : null;
}

export function summarizeMcpResult(result: McpOperationResult): string {
  if (result.summary?.trim()) return result.summary.trim();
  const count = countFromEnvelope(result.envelope);
  if (count !== null) return `Returned ${count} ${count === 1 ? "record" : "records"}.`;
  return "Greenroom request completed.";
}

/** Produces the dual text + typed result expected by MCP clients. */
export function shapeMcpToolSuccess(result: McpOperationResult): CallToolResult {
  return {
    content: [{ type: "text", text: summarizeMcpResult(result) }],
    structuredContent: result.envelope,
  };
}

export function mcpErrorEnvelope(error: unknown, requestId: string): McpErrorEnvelope {
  if (error instanceof McpOperationError) {
    return {
      error: {
        code: apiErrorCode(error),
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId,
      },
    };
  }
  return {
    error: {
      code: "internal_error",
      message: "An unexpected error occurred.",
      requestId,
    },
  };
}

/** Application/tool failures stay in-band so a model can inspect and correct them. */
export function shapeMcpToolError(error: unknown, requestId: string): CallToolResult {
  const envelope = mcpErrorEnvelope(error, requestId);
  return {
    content: [{ type: "text", text: envelope.error.message }],
    structuredContent: envelope,
    isError: true,
  };
}

export function shapeMcpResource(result: McpOperationResult, uri: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(result.envelope),
      },
    ],
    ttlMs: 0,
    cacheScope: "private",
  };
}
