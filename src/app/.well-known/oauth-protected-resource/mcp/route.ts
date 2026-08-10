import { protectedResourceMetadataResponse } from "@/lib/mcp-auth-metadata";

export function GET(request: Request): Response {
  return protectedResourceMetadataResponse(request, "/mcp");
}

export function OPTIONS(request: Request): Response {
  return protectedResourceMetadataResponse(request, "/mcp");
}
