import { apiData, withApiRequest } from "@/lib/api-request";
import { confirmApiSpeaker } from "@/app/api/v1/_lib/write";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string; speakerId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, speakerId } = await params;
    return apiData(
      await confirmApiSpeaker(request, eventId, speakerId),
      context,
    );
  });
}
