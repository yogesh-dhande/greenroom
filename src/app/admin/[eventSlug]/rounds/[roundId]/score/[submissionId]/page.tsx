import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { ROUND_STATE_LABEL, canScoreSubmission, roundState } from "@/domain/rounds";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { loadRound, loadRoundSubmissions } from "../../../data";
import { ScorecardForm } from "./scorecard-form";

/**
 * One submission's scorecard, as its assigned reviewer sees it (rubric ABS-03,
 * ABS-12).
 *
 * The gate is the reviewer's own assignment row, re-read here from the session
 * id: guessing another submission's id in the URL gets a 404, not a form. The
 * page shows the proposal and this reviewer's own answers — never the aggregate
 * and never anyone else's scorecard.
 */
export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ eventSlug: string; roundId: string; submissionId: string }>;
}) {
  const { eventSlug, roundId, submissionId } = await params;
  const viewer = await requireAdminOrReviewer(
    `/admin/${eventSlug}/rounds/${roundId}/score/${submissionId}`,
  );
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;

  const mine = await repos.reviewRounds.listAssignmentsByReviewer(viewer.id);
  if (!canScoreSubmission(mine, roundId, viewer.id, submissionId)) notFound();
  const assignment = mine.find(
    (row) => row.roundId === roundId && row.submissionId === submissionId,
  )!;

  const [submissions, existing] = await Promise.all([
    loadRoundSubmissions(repos, event.id),
    repos.reviewRounds.getScore(assignment.id),
  ]);
  const row = submissions.find((entry) => entry.submission.id === submissionId);
  if (!row) notFound();

  const state = roundState(round);

  return (
    <div>
      <PageHeader
        title={row.submission.title}
        description={`${round.name} — your scorecard`}
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds/${roundId}/score`}>Back to queue</Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <SubmissionStatusBadge status={row.submission.status} />
          <Badge variant={state === "open" ? "default" : "outline"}>
            {ROUND_STATE_LABEL[state]}
          </Badge>
          {row.trackNames.length > 0 ? <span>{row.trackNames.join(", ")}</span> : null}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {row.speakers.length > 1 ? "Speakers" : "Speaker"}
          </p>
          <p className="text-sm text-muted-foreground">
            {row.speakers.map((person) => person.name ?? person.email).join(", ") ||
              "No speaker on file"}
          </p>
        </div>
        {row.submission.description ? (
          <div>
            <p className="text-sm font-medium text-foreground">Abstract</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {row.submission.description}
            </p>
          </div>
        ) : null}
      </div>

      <ScorecardForm
        eventSlug={eventSlug}
        roundId={roundId}
        submissionId={submissionId}
        criteria={round.criteria}
        values={existing?.values ?? {}}
        submitted={Boolean(existing)}
        recused={assignment.status === "recused"}
        recusalReason={assignment.recusalReason}
        canScore={state === "open"}
      />
    </div>
  );
}
