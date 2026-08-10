import { apiData, withApiRequest } from "@/lib/api-request";
import { getSubmission } from "@/app/api/v1/_lib/read";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; submissionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, submissionId } = await params;
    return apiData(await getSubmission(request, eventId, submissionId), context);
  });
}
