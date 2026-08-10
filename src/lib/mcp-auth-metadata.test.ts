import { describe, expect, it } from "vitest";
import {
  buildGreenroomProtectedResourceMetadata,
  protectedResourceMetadataResponse,
} from "@/lib/mcp-auth-metadata";

describe("MCP OAuth protected-resource metadata", () => {
  it.each(["/mcp", "/api/v1"] as const)("publishes path-specific metadata for %s", (path) => {
    const metadata = buildGreenroomProtectedResourceMetadata("https://greenroom.example", path);

    expect(metadata).toMatchObject({
      resource: `https://greenroom.example${path}`,
      authorization_servers: ["https://greenroom.example/api/auth"],
      scopes_supported: ["greenroom:read", "greenroom:write"],
      bearer_methods_supported: ["header"],
    });
  });

  it("serves public, CORS-readable metadata", async () => {
    const response = protectedResourceMetadataResponse(
      new Request("https://greenroom.usespaces.dev/.well-known/oauth-protected-resource/mcp"),
      "/mcp",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toMatchObject({ resource: "https://greenroom.usespaces.dev/mcp" });
  });

  it("identifies the path-scoped RFC 8414 discovery URL for the auth issuer", () => {
    const [issuer] = buildGreenroomProtectedResourceMetadata(
      "https://greenroom.usespaces.dev",
      "/mcp",
    ).authorization_servers;

    expect(
      new URL(
        `/.well-known/oauth-authorization-server${new URL(issuer).pathname}`,
        issuer,
      ).href,
    ).toBe(
      "https://greenroom.usespaces.dev/.well-known/oauth-authorization-server/api/auth",
    );
  });
});
