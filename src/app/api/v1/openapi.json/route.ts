import { openApiDocument } from "./document";

export async function GET(): Promise<Response> {
  return Response.json(openApiDocument, {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
