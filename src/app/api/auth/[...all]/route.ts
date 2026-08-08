import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// better-auth needs a fresh instance per request here since its D1 binding
// (via getCloudflareContext) isn't available until request time.
async function handler(request: Request) {
  const auth = await getAuth();
  return auth.handler(request);
}

export const { GET, POST } = toNextJsHandler(handler);
