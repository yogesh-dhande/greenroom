import { mcpDescriptor } from "@/lib/agent-discovery";
import { publicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/** Non-normative MCP descriptor — see src/lib/agent-discovery.ts. */
export async function GET(): Promise<Response> {
  return Response.json(mcpDescriptor(await publicBaseUrl()), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
