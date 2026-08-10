import { getCloudflareContext } from "@opennextjs/cloudflare";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/session";
import { ConnectionExamples } from "./connection-examples";
import { CreateKeyDialog } from "./create-key-dialog";
import { CredentialsTable } from "./credentials-table";
import { getApiCredentialAdminService } from "./credential-service";

const PAGE_PATH = "/admin/api";

export default async function ApiAndMcpPage() {
  const user = await requireAdmin(PAGE_PATH);
  const service = await getApiCredentialAdminService();
  const [credentials, events] = await Promise.all([
    service.listCredentials(user.id),
    service.listEvents(),
  ]);
  const { env } = await getCloudflareContext({ async: true });
  const baseUrl = (env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          title="API & MCP"
          description="Connect automations and AI tools to Greenroom with event-scoped credentials."
          action={<CreateKeyDialog events={events} />}
        />

        <Card>
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              Keys belong to your admin account. Greenroom checks your admin access again on every
              request, and write access always includes read access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {credentials.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No API keys yet."
                description="Create one to connect the REST API or remote MCP server."
              />
            ) : (
              <CredentialsTable credentials={credentials} events={events} />
            )}
          </CardContent>
        </Card>
      </div>

      <ConnectionExamples baseUrl={baseUrl} />
    </div>
  );
}
