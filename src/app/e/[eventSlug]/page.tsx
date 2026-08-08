import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { formatDateRange } from "@/components/date-format";

/** Public program page for an event (spec.md "Important": public schedule +
 * speaker gallery, embeddable). No auth. */
export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {event.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDateRange(event.startDate, event.endDate)}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      <EmptyState
        className="mt-8"
        title="The public schedule and speaker gallery aren't live yet"
        description="A mobile-friendly, embeddable program lands in a later wave."
      />
    </div>
  );
}
