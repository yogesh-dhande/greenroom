import { apiData, withApiRequest } from "@/lib/api-request";
import { getSession } from "@/app/api/v1/_lib/read";
import { updateApiSession } from "@/app/api/v1/_lib/write";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; sessionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, sessionId } = await params;
    return apiData(await getSession(request, eventId, sessionId), context);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string; sessionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, sessionId } = await params;
    return apiData(
      await updateApiSession(request, eventId, sessionId),
      context,
    );
  });
}
