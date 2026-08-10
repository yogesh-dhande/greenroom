import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { loadRound, roundHasScorecards, viewerHasQueue } from "../data";
import { RoundForm } from "../round-form";
import { RoundNav } from "./round-nav";

/** Edit one round's dates and scorecard (rubric ABS-01/ABS-03/ABS-04). */
export default async function RoundSetupPage({
  params,
}: {
  params: Promise<{ eventSlug: string; roundId: string }>;
}) {
  const { eventSlug, roundId } = await params;
  const viewer = await requireAdmin(`/admin/${eventSlug}/rounds/${roundId}`);
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;
  const [hasQueue, criteriaLocked] = await Promise.all([
    viewerHasQueue(repos, roundId, viewer.id),
    // A filed scorecard freezes the questions it answered (D-060) — the form
    // shows them read-only rather than letting an organizer find out on save.
    roundHasScorecards(repos, roundId),
  ]);

  return (
    <div>
      <PageHeader
        title={round.name}
        description="Setup — when this round runs and what reviewers are asked."
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds`}>Back to rounds</Link>
          </Button>
        }
      />
      <RoundNav eventSlug={eventSlug} roundId={roundId} active="setup" hasQueue={hasQueue} />
      <RoundForm
        eventSlug={eventSlug}
        eventTimezone={event.timezone}
        round={round}
        criteriaLocked={criteriaLocked}
      />
    </div>
  );
}
