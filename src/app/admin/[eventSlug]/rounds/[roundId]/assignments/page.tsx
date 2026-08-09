import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { personName } from "../../../submissions/queue";
import { loadReviewerPool, loadRound, loadRoundSubmissions, loadRoundWork } from "../../data";
import { RoundNav } from "../round-nav";
import { AssignmentManager, type AssignmentRow, type SubmissionOption } from "./assignment-manager";

/**
 * Who reviews what, in this round (rubric ABS-05 individual assignment,
 * ABS-06 track-wide bulk assignment, ABS-02 a per-round reviewer pool,
 * ABS-08 progress).
 */
export default async function RoundAssignmentsPage({
  params,
}: {
  params: Promise<{ eventSlug: string; roundId: string }>;
}) {
  const { eventSlug, roundId } = await params;
  await requireAdmin(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;

  const [submissions, work, tracks, pool] = await Promise.all([
    loadRoundSubmissions(repos, event.id),
    loadRoundWork(repos, roundId),
    repos.tracks.listByEvent(event.id),
    loadReviewerPool(repos),
  ]);

  const poolById = new Map(pool.map((person) => [person.id, person]));
  const scored = new Set(work.scores.map((score) => score.assignmentId));

  const options: SubmissionOption[] = submissions.map((row) => ({
    id: row.submission.id,
    title: row.submission.title,
    speakers: row.speakers.map((person) => personName(person)),
    trackIds: row.trackIds,
    trackNames: row.trackNames,
    status: row.submission.status,
  }));

  const rows: AssignmentRow[] = work.assignments.map((assignment) => {
    const reviewer = poolById.get(assignment.reviewerId);
    return {
      id: assignment.id,
      submissionId: assignment.submissionId,
      reviewerId: assignment.reviewerId,
      reviewerName: reviewer ? personName(reviewer) : "Unknown reviewer",
      status: assignment.status,
      recusalReason: assignment.recusalReason,
      scored: scored.has(assignment.id),
    };
  });

  return (
    <div>
      <PageHeader
        title={round.name}
        description="Assignments — a reviewer's queue is exactly what you give them here."
        action={
          <Button asChild variant="outline">
            <Link href={`/admin/${eventSlug}/rounds`}>Back to rounds</Link>
          </Button>
        }
      />
      <RoundNav eventSlug={eventSlug} roundId={roundId} active="assignments" />
      <AssignmentManager
        eventSlug={eventSlug}
        roundId={roundId}
        roundName={round.name}
        reviewers={pool.map((person) => ({
          id: person.id,
          name: personName(person),
          email: person.email,
          role: person.role,
        }))}
        tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
        submissions={options}
        assignments={rows}
      />
    </div>
  );
}
