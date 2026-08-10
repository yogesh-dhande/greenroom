import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CompletionMeter } from "@/components/completion-meter";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  ROUND_STATE_LABEL,
  assignmentsForReviewer,
  hidesSpeakerIdentity,
  progressLabel,
  roundState,
  speakerLine,
  withoutSpeakers,
} from "@/domain/rounds";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { loadRound, loadRoundSubmissions, roundWindowLabel } from "../../data";

/**
 * A reviewer's queue for one round (rubric ABS-05).
 *
 * The list is built from this reviewer's own assignment rows — read with their
 * session id, not with anything the page was navigated with — so it contains
 * exactly what they were given and nothing else. No aggregate and no other
 * reviewer's scorecard appears anywhere on the reviewer side.
 *
 * On a blind round (decisions.md D-049) the speakers are dropped from the rows
 * here, in the loader, rather than hidden in the markup — the names never make
 * it into the rendered page at all.
 */
export default async function ReviewerQueuePage({
  params,
}: {
  params: Promise<{ eventSlug: string; roundId: string }>;
}) {
  const { eventSlug, roundId } = await params;
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/rounds/${roundId}/score`);
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;

  const mine = assignmentsForReviewer(
    await repos.reviewRounds.listAssignmentsByReviewer(viewer.id),
    roundId,
    viewer.id,
  );
  const myScores = await repos.reviewRounds.listScoresByAssignments(
    mine.map((assignment) => assignment.id),
  );
  const scored = new Set(myScores.map((score) => score.assignmentId));

  const blind = hidesSpeakerIdentity(round);
  const submissions = withoutSpeakers(await loadRoundSubmissions(repos, event.id), blind);
  const byId = new Map(submissions.map((row) => [row.submission.id, row]));

  const state = roundState(round);
  const required = mine.filter((assignment) => assignment.status !== "recused");
  const done = required.filter((assignment) => scored.has(assignment.id));

  return (
    <div>
      <PageHeader
        title={round.name}
        description={round.description ?? "Your review queue for this round."}
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds`}>All rounds</Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant={state === "open" ? "default" : "outline"}>{ROUND_STATE_LABEL[state]}</Badge>
        <span>{roundWindowLabel(round, event.timezone)}</span>
        <CompletionMeter
          done={done.length}
          total={required.length}
          label={progressLabel({ done: done.length, required: required.length })}
          emptyLabel="Nothing assigned"
        />
        {blind ? <Badge variant="outline">Blind review</Badge> : null}
      </div>

      {mine.length === 0 ? (
        <EmptyState
          title="Nothing assigned to you in this round"
          description="An organizer decides who reviews what. Check back once they've handed out this round."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submission</TableHead>
              <TableHead>Tracks</TableHead>
              <TableHead>Your scorecard</TableHead>
              <TableHead className="text-right">&nbsp;</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.map((assignment) => {
              const row = byId.get(assignment.submissionId);
              const isScored = scored.has(assignment.id);
              return (
                <TableRow key={assignment.id} data-testid="queue-row">
                  <TableCell>
                    <p className="font-medium text-foreground">
                      {row?.submission.title ?? "Withdrawn submission"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {speakerLine(
                        row?.speakers.map((person) => person.name ?? person.email) ?? [],
                        blind,
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row?.trackNames.join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {assignment.status === "recused" ? (
                      <Badge variant="outline">Recused</Badge>
                    ) : isScored ? (
                      <Badge variant="secondary">Submitted</Badge>
                    ) : (
                      <Badge variant="outline">Not started</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant={isScored ? "outline" : "default"}>
                      <Link
                        href={`/admin/${eventSlug}/rounds/${roundId}/score/${assignment.submissionId}`}
                      >
                        {isScored ? "Review scorecard" : "Score"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
