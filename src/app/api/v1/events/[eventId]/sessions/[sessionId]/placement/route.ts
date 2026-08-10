import { apiData, withApiRequest } from "@/lib/api-request";
import {
  placeApiSession,
  unscheduleApiSession,
} from "@/app/api/v1/_lib/write";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string; sessionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, sessionId } = await params;
    return apiData(
      await placeApiSession(request, eventId, sessionId),
      context,
    );
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string; sessionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, sessionId } = await params;
    return apiData(await unscheduleApiSession(request, eventId, sessionId), context);
  });
}
