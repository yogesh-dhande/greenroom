import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";

/** Root discovery bridge: Better Auth itself is mounted under /api/auth. */
export async function GET(request: Request): Promise<Response> {
  const auth = await getAuth();
  return oauthProviderAuthServerMetadata(auth, {
    headers: { "cache-control": "public, max-age=300" },
  })(request);
}
