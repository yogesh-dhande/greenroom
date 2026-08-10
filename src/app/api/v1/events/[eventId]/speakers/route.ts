import {
  applySpeakerCollectionQuery,
  parseCollectionQuery,
  speakerCollectionQuerySchema,
} from "@/domain/api-query";
import { apiCollection, apiData, withApiRequest } from "@/lib/api-request";
import { listSpeakers } from "@/app/api/v1/_lib/read";
import { createApiSpeaker } from "@/app/api/v1/_lib/write";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId } = await params;
    const query = parseCollectionQuery(
      speakerCollectionQuerySchema,
      new URL(request.url).searchParams,
    );
    const result = applySpeakerCollectionQuery(await listSpeakers(request, eventId), query);
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
      await createApiSpeaker(request, eventId),
      context,
      { status: 201 },
    );
  });
}
