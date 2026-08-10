import {
  applySessionCollectionQuery,
  parseCollectionQuery,
  sessionCollectionQuerySchema,
} from "@/domain/api-query";
import { apiCollection, apiData, withApiRequest } from "@/lib/api-request";
import { listSessions } from "@/app/api/v1/_lib/read";
import { createApiSession } from "@/app/api/v1/_lib/write";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId } = await params;
    const query = parseCollectionQuery(
      sessionCollectionQuerySchema,
      new URL(request.url).searchParams,
    );
    const result = applySessionCollectionQuery(await listSessions(request, eventId), query);
    return apiCollection(result.data, result.pagination, context);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId } = await params;
    return apiData(
      await createApiSession(request, eventId),
      context,
      { status: 201 },
    );
  });
}
