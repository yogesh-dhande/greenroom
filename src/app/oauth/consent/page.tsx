import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";
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
  let client: Awaited<ReturnType<typeof auth.api.getOAuthClient>>;
  try {
    client = await auth.api.getOAuthClient({
      headers: await headers(),
      query: { client_id: clientId },
    });
  } catch {
    notFound();
  }

  const oauthQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : []) {
      oauthQuery.append(key, item);
    }
  }
  const scopes = scope.split(/\s+/).filter((value) => value.startsWith("greenroom:"));
  const clientName = typeof client.name === "string" && client.name ? client.name : "this client";

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
                <li key={item}>
                  {item === "greenroom:write"
                    ? "Read and change event sessions, speakers, scheduling, and decisions"
                    : "Read events, sessions, speakers, submissions, and configuration"}
                </li>
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
