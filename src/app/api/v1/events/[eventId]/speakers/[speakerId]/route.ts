import { apiData, withApiRequest } from "@/lib/api-request";
import { getSpeaker } from "@/app/api/v1/_lib/read";
import { updateApiSpeaker } from "@/app/api/v1/_lib/write";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; speakerId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, speakerId } = await params;
    return apiData(await getSpeaker(request, eventId, speakerId), context);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string; speakerId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, speakerId } = await params;
    return apiData(
      await updateApiSpeaker(request, eventId, speakerId),
      context,
    );
  });
}
