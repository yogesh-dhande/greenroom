import { createGreenroomMcpPostHandler } from "@/lib/mcp-server";
import { productionMcpRuntime } from "@/lib/mcp-production-runtime";

export const dynamic = "force-dynamic";

const handler = createGreenroomMcpPostHandler(productionMcpRuntime);

export const POST = handler.POST;
