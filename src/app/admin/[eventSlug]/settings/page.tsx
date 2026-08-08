import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateRange } from "@/components/date-format";
import { requireAdmin } from "@/lib/session";

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  // Event configuration is organizer-only: reviewers get the rest of /admin
  // but are bounced back to the overview here.
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Event identity, dates, and location. Editing lands in a later wave."
      />
      <Card>
        <CardContent>
          <dl className="divide-y divide-border">
            <DefRow label="Name" value={event.name} />
            <DefRow label="Slug" value={event.slug} />
            <DefRow label="Dates" value={formatDateRange(event.startDate, event.endDate)} />
            <DefRow label="Timezone" value={event.timezone} />
            <DefRow label="Location" value={event.location ?? "Not set"} />
            <DefRow label="Description" value={event.description ?? "Not set"} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
