import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { buildResultRows, loadRound, loadRoundSubmissions, loadRoundWork } from "../../data";
import { RoundNav } from "../round-nav";
import { ResultsTable } from "./results-table";

/**
 * Round results (rubric ABS-10 aggregate + sortable, ABS-13 CSV export).
 *
 * Organizer-only: reviewers never see the aggregate or each other's scorecards,
 * so this page is behind `requireAdmin` rather than the admin-area guard.
 */
export default async function RoundResultsPage({
  params,
}: {
  params: Promise<{ eventSlug: string; roundId: string }>;
}) {
  const { eventSlug, roundId } = await params;
  await requireAdmin(`/admin/${eventSlug}/rounds/${roundId}/results`);
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;

  const [submissions, work] = await Promise.all([
    loadRoundSubmissions(repos, event.id),
    loadRoundWork(repos, roundId),
  ]);
  const rows = buildResultRows(round, submissions, work.assignments, work.scores);

  const scorecards = work.scores.length;
  const outstanding = work.assignments.filter(
    (assignment) => assignment.status !== "recused",
  ).length - scorecards;

  return (
    <div>
      <PageHeader
        title={round.name}
        description="Results — the weighted aggregate of every scorecard filed in this round."
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/admin/${eventSlug}/rounds/${roundId}/results/csv`}>Download CSV</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/${eventSlug}/rounds`}>Back to rounds</Link>
            </Button>
          </div>
        }
      />
      <RoundNav eventSlug={eventSlug} roundId={roundId} active="results" />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Submissions in round" value={rows.length} />
        <StatCard label="Scorecards filed" value={scorecards} />
        <StatCard label="Still outstanding" value={Math.max(outstanding, 0)} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing scored yet"
          description="Assign submissions to reviewers, and their scores will roll up here."
          action={
            <Button asChild size="sm">
              <Link href={`/admin/${eventSlug}/rounds/${roundId}/assignments`}>
                Go to assignments
              </Link>
            </Button>
          }
        />
      ) : (
        <ResultsTable rows={rows} />
      )}
    </div>
  );
}
