import {
  createGreenroomMcpPostHandler,
  MCP_ALLOWED_METHODS,
  mcpMethodNotAllowedResponse,
} from "@/lib/mcp-server";
import { productionMcpRuntime } from "@/lib/mcp-production-runtime";

export const dynamic = "force-dynamic";

const handler = createGreenroomMcpPostHandler(productionMcpRuntime);

export const POST = handler.POST;

// Answer the rest of the Streamable HTTP method surface explicitly rather than
// letting the framework emit a bare 405 with no `Allow` header — see
// mcpMethodNotAllowedResponse for why a probing client needs the difference.
export const GET = mcpMethodNotAllowedResponse;
export const DELETE = mcpMethodNotAllowedResponse;

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { allow: MCP_ALLOWED_METHODS, "cache-control": "private, no-store" },
  });
}
