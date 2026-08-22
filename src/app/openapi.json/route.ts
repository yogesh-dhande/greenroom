import { permanentRedirect } from "next/navigation";
import { AGENT_ENDPOINTS } from "@/lib/agent-discovery";

/**
 * Root-level alias for the OpenAPI document, which really lives under the
 * version prefix at /api/v1/openapi.json. A permanent redirect rather than a
 * second copy so the versioned path stays the single source of the document.
 */
export function GET(): never {
  permanentRedirect(AGENT_ENDPOINTS.openapi);
}
