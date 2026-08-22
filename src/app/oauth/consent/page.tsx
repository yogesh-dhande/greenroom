import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";
import {
  CONSENT_SCOPE_DESCRIPTION,
  isClientNotFoundError,
  parseConsentScopes,
} from "@/lib/oauth-consent";
import { requireAdmin } from "@/lib/session";
import { approveOAuthConsent, denyOAuthConsent } from "./actions";

interface ConsentPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OAuthConsentPage({ searchParams }: ConsentPageProps) {
  await requireAdmin("/oauth/consent");
  const params = await searchParams;
  const clientId = first(params.client_id);
  const scope = first(params.scope) ?? "greenroom:read";
  if (!clientId) notFound();

  const auth = await getAuth();
  // `getOAuthClientPublic` and not `getOAuthClient`: the owner-scoped lookup
  // ends in `else throw UNAUTHORIZED` for any client whose `userId` and
  // `referenceId` are both null, and that is *every* client created through the
  // unauthenticated dynamic registration we enable for MCP clients in
  // src/lib/auth.ts. Pairing it with a blanket `catch { notFound() }` made the
  // consent screen 404 for exactly the clients it exists to serve, which took
  // the whole OAuth/MCP surface down. The public lookup performs no ownership
  // check and returns the one field this screen reads: `name`.
  //
  // This is not a widening of access. `requireAdmin` above is the authorization
  // boundary, and `getOAuthClientPublic` still runs behind Better Auth's
  // session middleware.
  let client: Awaited<ReturnType<typeof auth.api.getOAuthClientPublic>>;
  try {
    client = await auth.api.getOAuthClientPublic({
      headers: await headers(),
      query: { client_id: clientId },
    });
  } catch (error) {
    // Only a genuine "no such client" may become a 404. Anything else stays
    // loud so it lands in Workers Logs instead of masquerading as a bad link.
    if (isClientNotFoundError(error)) notFound();
    console.error("oauth consent: client lookup failed", { clientId, error });
    throw error;
  }

  const oauthQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : []) {
      oauthQuery.append(key, item);
    }
  }
  const scopes = parseConsentScopes(scope);
  // `client_name`, not `name`: the endpoint returns the RFC 7591 registration
  // shape (better-auth's `schemaToOAuth` maps name -> client_name, uri ->
  // client_uri, and so on). Reading `.name` here silently produced `undefined`
  // for every client, so the screen always asked about "this client" — an
  // admin was approving a connection the page could not name.
  const registeredName = client.client_name;
  const clientName =
    typeof registeredName === "string" && registeredName ? registeredName : "this client";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Allow {clientName} to use Greenroom?</CardTitle>
          <CardDescription>
            This connection acts with your administrator access. You can stop it by revoking
            consent or removing your admin role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-md border p-4">
            <p className="text-sm font-medium">Requested access</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {scopes.map((item) => (
                <li key={item}>{CONSENT_SCOPE_DESCRIPTION[item]}</li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end gap-3">
            <form action={denyOAuthConsent}>
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="oauthQuery" value={oauthQuery.toString()} />
              <Button type="submit" variant="outline">Deny</Button>
            </form>
            <form action={approveOAuthConsent}>
              <input type="hidden" name="scope" value={scope} />
              <input type="hidden" name="oauthQuery" value={oauthQuery.toString()} />
              <Button type="submit">Allow access</Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
