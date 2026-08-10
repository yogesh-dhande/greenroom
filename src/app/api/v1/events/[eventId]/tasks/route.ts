import {
  collectionQuerySchema,
  paginateCollection,
  parseCollectionQuery,
  sortCollection,
} from "@/domain/api-query";
import { apiCollection, withApiRequest } from "@/lib/api-request";
import { listTasks } from "@/app/api/v1/_lib/read";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const { eventId } = await params;
    const query = parseCollectionQuery(collectionQuerySchema, new URL(request.url).searchParams);
    const rows = sortCollection(await listTasks(request, eventId), query.sort, query.direction);
    const result = paginateCollection(rows, query.page, query.pageSize);
    return apiCollection(result.data, result.pagination, context);
  });
}
