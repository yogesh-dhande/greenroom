import { getFilesBucket } from "@/lib/db";
import { filenameFromKey, isServableKey } from "@/lib/uploads";

/**
 * Serves an uploaded file back out of R2 (spec.md §2 — headshots, supporting
 * documents). Uploads are written by the CFP submission flow with keys under
 * `uploads/`, and `isServableKey` is what stops this route from becoming a
 * reader for the rest of the bucket (which also backs the incremental cache,
 * see open-next.config.ts).
 *
 * Deliberately unauthenticated: headshots are shown on public speaker pages,
 * and keys carry a random segment, so they're unguessable capability URLs
 * rather than secrets.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");
  if (!isServableKey(key)) return new Response("Not found", { status: 404 });

  const bucket = await getFilesBucket();
  const object = await bucket.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  // The stored metadata is copied field by field rather than with R2's
  // `writeHttpMetadata(headers)`: in `next dev` the bucket is a proxy to
  // Miniflare, and handing a `Headers` instance across that boundary fails
  // with "Cannot stringify arbitrary non-POJOs".
  const metadata = object.httpMetadata ?? {};
  const headers = new Headers();
  if (metadata.contentType) headers.set("content-type", metadata.contentType);
  if (metadata.contentLanguage) headers.set("content-language", metadata.contentLanguage);
  if (metadata.contentEncoding) headers.set("content-encoding", metadata.contentEncoding);
  headers.set("etag", object.httpEtag);
  // Immutable: the random key segment changes whenever the file does.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set(
    "content-disposition",
    `inline; filename="${filenameFromKey(key).replace(/"/g, "")}"`,
  );
  return new Response(object.body, { headers });
}
