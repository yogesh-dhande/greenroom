import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";

export default async function PortalHomePage() {
  const user = await requireUser("/portal");

  return (
    <div>
      <PageHeader title="Your speaker home" description={`Signed in as ${user.email}`} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Your submissions</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Nothing submitted yet"
              description="Talks you submit to a call for speakers will show up here."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No sessions yet"
              description="Accepted talks turn into scheduled sessions here."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Nothing to do yet"
              description="Onboarding tasks — forms, uploads, confirmations — will appear here."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
