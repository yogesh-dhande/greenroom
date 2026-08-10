import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";

/** Canonical RFC 8414 discovery path for the /api/auth issuer. */
export async function GET(request: Request): Promise<Response> {
  const auth = await getAuth();
  return oauthProviderAuthServerMetadata(auth, {
    headers: { "cache-control": "public, max-age=300" },
  })(request);
}
