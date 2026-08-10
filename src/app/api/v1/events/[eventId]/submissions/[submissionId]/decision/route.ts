import { apiData, withApiRequest } from "@/lib/api-request";
import { decideApiSubmission } from "@/app/api/v1/_lib/write";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string; submissionId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId, submissionId } = await params;
    return apiData(
      await decideApiSubmission(request, eventId, submissionId),
      context,
    );
  });
}
