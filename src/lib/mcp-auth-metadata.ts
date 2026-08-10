export const GREENROOM_OAUTH_SCOPES = ["greenroom:read", "greenroom:write"] as const;

export function buildGreenroomProtectedResourceMetadata(
  origin: string,
  resourcePath: "/mcp" | "/api/v1",
) {
  const normalizedOrigin = new URL(origin).origin;
  return {
    resource: `${normalizedOrigin}${resourcePath}`,
    authorization_servers: [`${normalizedOrigin}/api/auth`],
    scopes_supported: [...GREENROOM_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name:
      resourcePath === "/mcp" ? "Greenroom MCP server" : "Greenroom Core API v1",
    resource_documentation: `${normalizedOrigin}/api/docs`,
  };
}

export function protectedResourceMetadataResponse(
  request: Request,
  resourcePath: "/mcp" | "/api/v1",
): Response {
  const url = new URL(request.url);
  const validatedHost = validateHostHeader(
    request.headers.get("host") ?? url.host,
    defaultMcpAllowedHostnames(),
  );
  if (!validatedHost.ok) {
    return Response.json(
      { error: "invalid_request", error_description: "Invalid Host header." },
      { status: 403 },
    );
  }
  const headers = {
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=300",
    "content-type": "application/json; charset=utf-8",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
      },
    });
  }
  return new Response(
    JSON.stringify(buildGreenroomProtectedResourceMetadata(url.origin, resourcePath)),
    { headers },
  );
}
import {
  defaultMcpAllowedHostnames,
} from "@/lib/mcp-security";
import { validateHostHeader } from "@modelcontextprotocol/server";
