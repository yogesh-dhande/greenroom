import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { personName } from "../../../submissions/queue";
import {
  eligibleReviewersBySubmission,
  loadReviewerPool,
  loadRound,
  loadRoundSubmissions,
  loadRoundWork,
  viewerHasQueue,
} from "../../data";
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
  const viewer = await requireAdmin(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
  const repos = await getRepos();
  const loaded = await loadRound(repos, eventSlug, roundId);
  if (!loaded) notFound();
  const { event, round } = loaded;

  const [submissions, work, tracks, pool, hasQueue] = await Promise.all([
    loadRoundSubmissions(repos, event.id),
    loadRoundWork(repos, roundId),
    repos.tracks.listByEvent(event.id),
    loadReviewerPool(repos, event.id),
    viewerHasQueue(repos, roundId, viewer.id),
  ]);
  const lastReminder = (
    await repos.emailLog.listByRelated("review_round", round.id)
  ).find((entry) => entry.kind === "round_reminder") ?? null;

  const poolById = new Map(pool.map((member) => [member.user.id, member.user]));
  const scored = new Set(work.scores.map((score) => score.assignmentId));

  // Who each submission may go to, decided server-side from the track join
  // (D-061) — the picker only renders the answer.
  const eligible = eligibleReviewersBySubmission(pool, submissions);

  const options: SubmissionOption[] = submissions.map((row) => ({
    id: row.submission.id,
    title: row.submission.title,
    speakers: row.speakers.map((person) => personName(person)),
    trackIds: row.trackIds,
    trackNames: row.trackNames,
    status: row.submission.status,
    reviewerIds: eligible[row.submission.id] ?? [],
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
      <RoundNav eventSlug={eventSlug} roundId={roundId} active="assignments" hasQueue={hasQueue} />
      <AssignmentManager
        eventSlug={eventSlug}
        roundId={roundId}
        roundName={round.name}
        reviewers={pool.map(({ user }) => ({
          id: user.id,
          name: personName(user),
          email: user.email,
          role: user.role,
        }))}
        tracks={tracks.map((track) => ({ id: track.id, name: track.name }))}
        submissions={options}
        assignments={rows}
        lastReminder={
          lastReminder
            ? {
                to: lastReminder.to,
                status: lastReminder.status,
                sentAtLabel: new Intl.DateTimeFormat("en-US", {
                  timeZone: event.timezone,
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })
                  .format(lastReminder.sentAt)
                  .replace(",", ""),
              }
            : null
        }
      />
    </div>
  );
}
