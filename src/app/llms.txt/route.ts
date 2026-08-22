import { llmsTxt } from "@/lib/agent-discovery";
import { publicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/** Orientation page for agents — see src/lib/agent-discovery.ts. */
export async function GET(): Promise<Response> {
  return new Response(llmsTxt(await publicBaseUrl()), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
