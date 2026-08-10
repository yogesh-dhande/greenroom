import {
  applySubmissionCollectionQuery,
  parseCollectionQuery,
  submissionCollectionQuerySchema,
} from "@/domain/api-query";
import { apiCollection, withApiRequest } from "@/lib/api-request";
import { listSubmissions } from "@/app/api/v1/_lib/read";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId } = await params;
    const query = parseCollectionQuery(
      submissionCollectionQuerySchema,
      new URL(request.url).searchParams,
    );
    const result = applySubmissionCollectionQuery(await listSubmissions(request, eventId), query);
    return apiCollection(result.data, result.pagination, context);
  });
}
