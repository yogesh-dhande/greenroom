import { apiData, withApiRequest } from "@/lib/api-request";
import { getEvent } from "@/app/api/v1/_lib/read";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId } = await params;
    return apiData(await getEvent(request, eventId), context);
  });
}
