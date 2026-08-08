import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function CommunicationsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  return (
    <div>
      <PageHeader
        title="Communications"
        description="Confirmation, decision, and reminder emails — plus the calendar invites that go with them."
      />
      <EmptyState
        title="No messages sent yet"
        description="Templated emails, calendar invites, and a per-speaker communication log land in a later wave."
      />
    </div>
  );
}
