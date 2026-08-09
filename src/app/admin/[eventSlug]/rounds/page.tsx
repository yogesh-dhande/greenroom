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
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  ROUND_STATE_LABEL,
  hidesSpeakerIdentity,
  progressLabel,
  roundState,
  type RoundState,
} from "@/domain/rounds";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { roundWindowLabel } from "./data";

/**
 * The review plan: every round in this event, in the order they open
 * (spec.md "Important" — multi-round scored evaluations, rubric ABS-01).
 *
 * Reviewers get the same page narrowed to their own work — a round they hold no
 * assignment in doesn't exist for them, and the narrowing is done from their own
 * assignment rows rather than by hiding links.
 */

const STATE_VARIANT: Record<RoundState, "default" | "secondary" | "outline"> = {
  open: "default",
  upcoming: "secondary",
  closed: "outline",
};

export default async function RoundsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/rounds`);
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const rounds = await repos.reviewRounds.listByEvent(event.id);
  const assignments = await repos.reviewRounds.listAssignmentsByRounds(
    rounds.map((round) => round.id),
  );
  const scores = await repos.reviewRounds.listScoresByAssignments(
    assignments.map((assignment) => assignment.id),
  );
  const scored = new Set(scores.map((score) => score.assignmentId));
  const isAdmin = viewer.role === "admin";

  const visible = isAdmin
    ? rounds
    : rounds.filter((round) =>
        assignments.some(
          (assignment) => assignment.roundId === round.id && assignment.reviewerId === viewer.id,
        ),
      );

  return (
    <div>
      <PageHeader
        title="Review rounds"
        description={
          isAdmin
            ? "Each round has its own dates, its own scorecard, and its own reviewers."
            : "The rounds you've been asked to review in."
        }
        action={
          isAdmin ? (
            <Button asChild>
              <Link href={`/admin/${eventSlug}/rounds/new`}>New round</Link>
            </Button>
          ) : undefined
        }
      />

      {visible.length === 0 ? (
        <EmptyState
          title={isAdmin ? "No review rounds yet" : "Nothing assigned to you yet"}
          description={
            isAdmin
              ? "Set up a first round — name it, give it dates, and build the scorecard reviewers will fill in."
              : "When an organizer assigns you submissions in a round, it'll show up here."
          }
          action={
            isAdmin ? (
              <Button asChild size="sm">
                <Link href={`/admin/${eventSlug}/rounds/new`}>Create a round</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Round</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Scorecard</TableHead>
              <TableHead>{isAdmin ? "Reviewers" : "Your queue"}</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="text-right">&nbsp;</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((round) => {
              const state = roundState(round);
              const mine = assignments.filter(
                (assignment) =>
                  assignment.roundId === round.id &&
                  (isAdmin || assignment.reviewerId === viewer.id),
              );
              const reviewers = new Set(mine.map((assignment) => assignment.reviewerId));
              // An admin on a program committee reviews like anyone else
              // (D-035(1): the assignment is the authorization), so the queue
              // button follows the assignment, not the role.
              const hasQueue = assignments.some(
                (assignment) =>
                  assignment.roundId === round.id && assignment.reviewerId === viewer.id,
              );
              const required = mine.filter((assignment) => assignment.status !== "recused");
              const done = required.filter((assignment) => scored.has(assignment.id));
              return (
                <TableRow key={round.id}>
                  <TableCell>
                    <Link
                      href={
                        isAdmin
                          ? `/admin/${eventSlug}/rounds/${round.id}`
                          : `/admin/${eventSlug}/rounds/${round.id}/score`
                      }
                      className="font-medium text-foreground hover:underline"
                    >
                      {round.name}
                    </Link>
                    {/* Whether this round hides speaker identity from its
                        reviewers is part of the plan, so it reads off the
                        plan (decisions.md D-049). */}
                    {hidesSpeakerIdentity(round) ? (
                      <Badge variant="outline" className="ml-2">
                        Blind review
                      </Badge>
                    ) : null}
                    {round.description ? (
                      <p className="text-sm text-muted-foreground">{round.description}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_VARIANT[state]}>{ROUND_STATE_LABEL[state]}</Badge>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {roundWindowLabel(round, event.timezone)}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {round.criteria.length} criteria
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {isAdmin
                      ? `${reviewers.size} assigned`
                      : `${mine.length} submission${mine.length === 1 ? "" : "s"}`}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {progressLabel({ done: done.length, required: required.length })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {isAdmin ? (
                        <>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/admin/${eventSlug}/rounds/${round.id}/assignments`}>
                              Assign
                            </Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/admin/${eventSlug}/rounds/${round.id}/results`}>
                              Results
                            </Link>
                          </Button>
                        </>
                      ) : null}
                      {hasQueue ? (
                        <Button asChild size="sm">
                          <Link href={`/admin/${eventSlug}/rounds/${round.id}/score`}>
                            Open queue
                          </Link>
                        </Button>
                      ) : null}
                    </div>
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
