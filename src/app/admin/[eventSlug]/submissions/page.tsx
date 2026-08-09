import Link from "next/link";
import { notFound } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { formatDate } from "@/components/date-format";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { Badge } from "@/components/ui/badge";
import { DIRECT_TO_SESSION_LABEL } from "@/domain/forms";
import { BLIND_REVIEW_NOTICE } from "@/domain/rounds";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ALL } from "./filters";
import { filterQueue, loadSubmissionQueue, personName, summarizeTally } from "./queue";
import { SubmissionFilters } from "./submission-filters";

/**
 * The review queue (spec.md §4): every submission an organizer — or a reviewer,
 * narrowed to their own tracks — needs to work through, with the status and
 * review activity that say what to do next.
 */
export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ status?: string; track?: string }>;
}) {
  const { eventSlug } = await params;
  const { status = ALL, track = ALL } = await searchParams;
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/submissions`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const queue = await loadSubmissionQueue(repos, event, viewer);
  const rows = filterQueue(queue.rows, { status, track });

  const isReviewer = viewer.role === "reviewer";
  const trackOptions = isReviewer
    ? queue.tracks.filter((t) => queue.reviewerTrackIds.includes(t.id))
    : queue.tracks;

  return (
    <div>
      <PageHeader
        title="Submissions"
        description={
          isReviewer
            ? "The talks proposed in the tracks you review. Open one to record your recommendation."
            : "Every talk proposed to this event. Open one to see the full proposal and decide."
        }
        action={
          viewer.role === "admin" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/${eventSlug}/submissions/new`}>
                <PlusIcon />
                Add a submission
              </Link>
            </Button>
          ) : null
        }
      />

      {queue.rows.length === 0 ? (
        <EmptyState
          title={isReviewer ? "Nothing to review yet" : "No submissions yet"}
          description={
            isReviewer
              ? "Submissions appear here once a talk is proposed in one of your tracks."
              : "They'll show up here as soon as speakers submit via a published form — or add one yourself for a talk that came to you another way."
          }
        />
      ) : (
        <>
          <SubmissionFilters
            tracks={trackOptions}
            status={status}
            track={track}
            total={queue.rows.length}
            shown={rows.length}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              description="Try a different status or track."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Talk</TableHead>
                  <TableHead>Speakers</TableHead>
                  <TableHead>Track(s)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviews</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ submission, trackNames, speakers, blind, tally, rollup }) => (
                  <TableRow key={submission.id} className="relative">
                    <TableCell className="max-w-96 font-medium whitespace-normal text-foreground">
                      {/* Whole-row click target: the title link's overlay
                          pseudo-element stretches across the positioned
                          `TableRow` (same overlay-link pattern as the public
                          schedule's SessionCard), so a pointer anywhere on
                          the row navigates while the accessible name and the
                          real `href` stay on the title itself — genuine
                          anchor semantics (middle-click, open-in-new-tab). */}
                      <Link
                        href={`/admin/${eventSlug}/submissions/${submission.id}`}
                        className="underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                      >
                        {submission.title}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {/* A row this viewer scores in a blind round reads the
                          same marker its scorecard does — the queue must not be
                          the way around the round's blindness (D-049). */}
                      {blind
                        ? BLIND_REVIEW_NOTICE
                        : speakers.length === 0
                          ? "—"
                          : speakers.map((person) => personName(person)).join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {trackNames.length === 0 ? "—" : trackNames.join(", ")}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SubmissionStatusBadge status={submission.status} />
                        {/* Why this one never queued for review (D-041). */}
                        {queue.directSessionFormIds.has(submission.formId) ? (
                          <Badge variant="outline">{DIRECT_TO_SESSION_LABEL}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {summarizeTally(tally, rollup.scorecards) || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(submission.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
