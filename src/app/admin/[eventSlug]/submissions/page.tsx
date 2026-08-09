import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer } from "@/lib/session";
import { formatDate } from "@/components/date-format";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
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
      />

      {queue.rows.length === 0 ? (
        <EmptyState
          title={isReviewer ? "Nothing to review yet" : "No submissions yet"}
          description={
            isReviewer
              ? "Submissions appear here once a talk is proposed in one of your tracks."
              : "They'll show up here as soon as speakers submit via a published form."
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
                {rows.map(({ submission, trackNames, speakers, tally }) => (
                  <TableRow key={submission.id}>
                    <TableCell className="max-w-96 font-medium whitespace-normal text-foreground">
                      <Link
                        href={`/admin/${eventSlug}/submissions/${submission.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {submission.title}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {speakers.length === 0
                        ? "—"
                        : speakers.map((person) => personName(person)).join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {trackNames.length === 0 ? "—" : trackNames.join(", ")}
                    </TableCell>
                    <TableCell>
                      <SubmissionStatusBadge status={submission.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {summarizeTally(tally) || "—"}
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
