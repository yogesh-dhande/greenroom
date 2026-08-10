import {
  collectionQuerySchema,
  paginateCollection,
  parseCollectionQuery,
  sortCollection,
} from "@/domain/api-query";
import { apiCollection, withApiRequest } from "@/lib/api-request";
import { listEvents } from "@/app/api/v1/_lib/read";

export async function GET(request: Request): Promise<Response> {
  return withApiRequest(request, async (context) => {
    const query = parseCollectionQuery(collectionQuerySchema, new URL(request.url).searchParams);
    const rows = await listEvents(request);
    const result = paginateCollection(
      sortCollection(rows, query.sort, query.direction),
      query.page,
      query.pageSize,
    );
    return apiCollection(result.data, result.pagination, context);
  });
}
