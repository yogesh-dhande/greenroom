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
import { countSubmissionsByStatus } from "@/domain/submissions";
import { QUEUE_VIEW_ALL, QUEUE_VIEW_ASSIGNED, resolveQueueView } from "@/domain/review";
import { ALL, VIEW_PARAM } from "./filters";
import {
  filterQueue,
  loadSubmissionQueue,
  personName,
  summarizeTally,
  type QueueRow,
} from "./queue";
import { SubmissionFilters } from "./submission-filters";

/**
 * The review queue (spec.md §4): every submission an organizer — or a reviewer,
 * narrowed to their own tracks — needs to work through, with the status and
 * review activity that say what to do next.
 *
 * A reviewer holding active round assignments lands on those instead
 * (decisions.md D-066), with one click to the full track-scoped list and back.
 * The choice is a URL parameter, so both lists are linkable and the back button
 * works; what a reviewer may *read* is unchanged either way (D-061).
 */
export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ status?: string; track?: string; q?: string; view?: string }>;
}) {
  const { eventSlug } = await params;
  const { status = ALL, track = ALL, q = "", view } = await searchParams;
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/submissions`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const queue = await loadSubmissionQueue(repos, event, viewer);
  // Assigned rows are the intersection of "handed to me" with "listed for me":
  // rows this viewer may not see were never in `queue.rows` to begin with, so
  // the default view can never widen what the track scoping allows (D-061).
  const assignedRows = queue.rows.filter((row) => row.assigned);
  const resolvedView = resolveQueueView(view, assignedRows.length);
  const scoped = resolvedView === QUEUE_VIEW_ASSIGNED ? assignedRows : queue.rows;

  const rows = filterQueue(scoped, { status, track, q });
  // Chip counts track the track filter (so a reviewer's own tracks stay
  // honest) but not the search box or the status itself - a chip always
  // says how many rows are one click away, not how many are currently shown.
  const trackRows = filterQueue(scoped, { status: ALL, track, q: "" });
  const statusCounts = countSubmissionsByStatus(trackRows.map((row) => row.submission.status));

  const isReviewer = viewer.role === "reviewer";
  const trackOptions = isReviewer
    ? queue.tracks.filter((t) => queue.reviewerTrackIds.includes(t.id))
    : queue.tracks;

  // The toggle keeps the filters that are already on, so switching lists is a
  // change of scope and not a reset.
  function viewHref(next: string): string {
    const params = new URLSearchParams();
    if (status !== ALL) params.set("status", status);
    if (track !== ALL) params.set("track", track);
    if (q) params.set("q", q);
    params.set(VIEW_PARAM, next);
    return `/admin/${eventSlug}/submissions?${params.toString()}`;
  }

  const showsToggle = assignedRows.length > 0;
  const onAssigned = resolvedView === QUEUE_VIEW_ASSIGNED;

  return (
    <div>
      <PageHeader
        title="Submissions"
        description={
          isReviewer
            ? onAssigned
              ? "The talks assigned to you in open review rounds. Open one to complete its scorecard."
              : "All submitted talks in the tracks you review. Browse these for context; only assigned talks can be scored."
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

      {/* Which list, in the reviewer's own words. Two links rather than a
          control with state: each list is a URL, so it is linkable and the
          back button takes you where you were (decisions.md D-066). */}
      {showsToggle ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Which talks to show"
        >
          <Button asChild size="sm" variant={onAssigned ? "default" : "outline"}>
            <Link
              href={viewHref(QUEUE_VIEW_ASSIGNED)}
              aria-current={onAssigned ? "page" : undefined}
            >
              Your assigned talks {assignedRows.length}
            </Link>
          </Button>
          <Button asChild size="sm" variant={onAssigned ? "outline" : "default"}>
            <Link href={viewHref(QUEUE_VIEW_ALL)} aria-current={onAssigned ? undefined : "page"}>
              All talks in your tracks {queue.rows.length}
            </Link>
          </Button>
        </div>
      ) : null}

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
            q={q}
            total={scoped.length}
            shown={rows.length}
            statusCounts={statusCounts}
            allCount={trackRows.length}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing matches those filters"
              description="Try a different search, status, or track."
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
                {rows.map((row) => (
                  <SubmissionRow
                    key={row.submission.id}
                    row={row}
                    eventSlug={eventSlug}
                    directSessionFormIds={queue.directSessionFormIds}
                    showAssignedBadge={!onAssigned}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One row of the queue. Split out of the page so the table body stays readable
 * now that a row also has to say whether it is this reviewer's to score.
 */
function SubmissionRow({
  row,
  eventSlug,
  directSessionFormIds,
  showAssignedBadge,
}: {
  row: QueueRow;
  eventSlug: string;
  directSessionFormIds: ReadonlySet<string>;
  showAssignedBadge: boolean;
}) {
  const { submission, trackNames, speakers, blind, assigned, tally, rollup } = row;
  return (
    <TableRow className="relative">
      <TableCell className="max-w-96 font-medium whitespace-normal text-foreground">
        {/* Whole-row click target: the title link's overlay pseudo-element
            stretches across the positioned `TableRow` (same overlay-link
            pattern as the public schedule's SessionCard), so a pointer
            anywhere on the row navigates while the accessible name and the
            real `href` stay on the title itself — genuine anchor semantics
            (middle-click, open-in-new-tab). */}
        <Link
          href={`/admin/${eventSlug}/submissions/${submission.id}`}
          className="underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
        >
          {submission.title}
        </Link>
        {/* On the wider list, which of these are actually yours to score
            (decisions.md D-066). */}
        {assigned && showAssignedBadge ? (
          <Badge variant="secondary" className="ml-2 align-middle">
            Assigned to you
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="max-w-64 truncate text-muted-foreground">
        {/* A row this viewer scores in a blind round reads the same marker its
            scorecard does — the queue must not be the way around the round's
            blindness (D-049). */}
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
          {directSessionFormIds.has(submission.formId) ? (
            <Badge variant="outline">{DIRECT_TO_SESSION_LABEL}</Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {summarizeTally(tally, rollup.scorecards) || "—"}
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(submission.createdAt)}</TableCell>
    </TableRow>
  );
}
