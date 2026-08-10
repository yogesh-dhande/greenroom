import { apiData, withApiRequest } from "@/lib/api-request";
import { suggestSessionSlot } from "@/app/api/v1/_lib/read";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; sessionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, sessionId } = await params;
    return apiData(await suggestSessionSlot(request, eventId, sessionId), context);
  });
}
