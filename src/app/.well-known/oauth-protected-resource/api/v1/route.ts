import { protectedResourceMetadataResponse } from "@/lib/mcp-auth-metadata";

export function GET(request: Request): Response {
  return protectedResourceMetadataResponse(request, "/api/v1");
}

export function OPTIONS(request: Request): Response {
  return protectedResourceMetadataResponse(request, "/api/v1");
}
