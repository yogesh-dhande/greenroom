import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { RoundForm } from "../round-form";

/** Set up a new review round (spec.md "Important" — multi-round evaluations). */
export default async function NewRoundPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  await requireAdmin(`/admin/${eventSlug}/rounds/new`);
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  return (
    <div>
      <PageHeader
        title="New review round"
        description="Rounds are independent: their own dates, their own scorecard, their own reviewers."
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds`}>Back to rounds</Link>
          </Button>
        }
      />
      <RoundForm eventSlug={eventSlug} eventTimezone={event.timezone} />
    </div>
  );
}
