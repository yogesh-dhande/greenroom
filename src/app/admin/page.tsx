import { redirect } from "next/navigation";
import { getRepos } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

/** Landing spot for /admin: jumps straight into the first event, since the
 * whole admin area is event-scoped. */
export default async function AdminIndexPage() {
  const repos = await getRepos();
  const events = await repos.events.listAll();

  if (events.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
        <PageHeader title="Greenroom" description="No events yet." />
        <EmptyState
          title="No events yet"
          description="Run `npm run seed` to load sample data, or create an event to get started."
        />
      </div>
    );
  }

  redirect(`/admin/${events[0].slug}`);
}
