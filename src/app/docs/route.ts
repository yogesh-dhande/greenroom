import { permanentRedirect } from "next/navigation";
import { AGENT_ENDPOINTS } from "@/lib/agent-discovery";

/** Root-level alias for the API reference at /api/docs. */
export function GET(): never {
  permanentRedirect(AGENT_ENDPOINTS.docs);
}
