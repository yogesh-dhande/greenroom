import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";

export const GREENROOM_PRODUCTION_HOSTNAME = "greenroom.usespaces.dev";

export interface McpRequestValidationOptions {
  allowedHostnames?: string[];
  allowedOriginHostnames?: string[];
}

export function defaultMcpAllowedHostnames(): string[] {
  return [GREENROOM_PRODUCTION_HOSTNAME, ...localhostAllowedHostnames()];
}

export function defaultMcpAllowedOriginHostnames(): string[] {
  return [GREENROOM_PRODUCTION_HOSTNAME, ...localhostAllowedOrigins()];
}

/**
 * MCP's DNS-rebinding protections. Native clients normally omit Origin; any
 * browser-originated request must come from a specifically allowed hostname.
 */
export function validateMcpRequest(
  request: Request,
  options: McpRequestValidationOptions = {},
): Response | undefined {
  const hostFailure = hostHeaderValidationResponse(
    request,
    options.allowedHostnames ?? defaultMcpAllowedHostnames(),
  );
  if (hostFailure) return hostFailure;
  return originValidationResponse(
    request,
    options.allowedOriginHostnames ?? defaultMcpAllowedOriginHostnames(),
  );
}

export function mcpResourceMetadataUrl(request: Request): string {
  return new URL("/.well-known/oauth-protected-resource/mcp", request.url).href;
}

export function withMcpAuthenticationChallenge(request: Request, response: Response): Response {
  if (response.status !== 401 && response.status !== 403) return response;
  const headers = new Headers(response.headers);
  if (!headers.has("www-authenticate")) {
    headers.set(
      "www-authenticate",
      `Bearer resource_metadata="${mcpResourceMetadataUrl(request)}", scope="greenroom:read"`,
    );
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
