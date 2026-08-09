import Link from "next/link";
import { DownloadIcon, PaperclipIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { buildAssignmentViews } from "@/domain/onboarding";
import {
  buildCommentThread,
  collectDeliverables,
  formatFileMoment,
  groupByAssignment,
} from "@/domain/files";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { FileCommentThread, FileVersionList } from "@/components/file-thread";
import { postDeliverableComment } from "./actions";

/**
 * Every file the event's speakers have sent in, in one place (spec.md §6,
 * decisions.md D-054 — the central files library).
 *
 * The rows come from `collectDeliverables`, the same collector the portal
 * uses, so an upload can't be visible on one surface and missing on the
 * other: a `file_request` assignment's own upload and a `form` task's file
 * answers both land here. Each row expands to what it replaced and to the
 * comment thread the speaker sees on their task card.
 *
 * Admin-only, like the roster it reports on (decisions.md D-047) — a
 * reviewer's workspace is submissions and rounds.
 */
export default async function FilesPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const [assignments, tasks, forms] = await Promise.all([
    repos.taskAssignments.listByEvent(event.id),
    repos.tasks.listByEvent(event.id),
    repos.forms.listByEvent(event.id),
  ]);

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [versions, comments] = await Promise.all([
    repos.fileVersions.listByAssignments(assignmentIds),
    repos.fileComments.listByAssignments(assignmentIds),
  ]);

  const deliverables = collectDeliverables({
    views: buildAssignmentViews(assignments, new Map(tasks.map((task) => [task.id, task]))),
    formsById: new Map(forms.map((form) => [form.id, form])),
    versionsByAssignment: groupByAssignment(versions),
  });
  const commentsByAssignment = groupByAssignment(comments);

  // Speakers behind the uploads and authors behind the comments, in one
  // lookup — the same person is usually both.
  const people = await repos.users.listByIds(
    Array.from(
      new Set([
        ...deliverables.map((deliverable) => deliverable.speakerId),
        ...comments.map((comment) => comment.authorId),
      ]),
    ),
  );
  const peopleById = new Map(people.map((person) => [person.id, person]));

  return (
    <div>
      <PageHeader
        title="Files"
        description="Every deliverable your speakers have uploaded — decks, headshots, paperwork — with what each one replaced and the conversation about it."
      />

      {deliverables.length === 0 ? (
        <EmptyState
          title="Nothing uploaded yet"
          description="Files speakers upload for their onboarding tasks land here — with the task they belong to, who sent them, and every earlier version."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Speaker</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Versions</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliverables.map((deliverable) => {
              const speaker = peopleById.get(deliverable.speakerId);
              const thread = buildCommentThread(
                commentsByAssignment.get(deliverable.assignmentId) ?? [],
                peopleById,
              );
              const rowKey = `${deliverable.assignmentId}-${deliverable.label}`;

              return [
                <TableRow key={rowKey} className="border-b-0">
                  <TableCell>
                    <a
                      href={deliverable.current.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {deliverable.current.filename}
                    </a>
                  </TableCell>
                  <TableCell>
                    {speaker ? (
                      <Link
                        href={`/admin/${eventSlug}/speakers/${speaker.id}`}
                        className="text-sm text-foreground underline-offset-4 hover:underline"
                      >
                        {speaker.name ?? speaker.email}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unknown speaker</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {deliverable.label}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatFileMoment(deliverable.current.uploadedAt, event.timezone)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {deliverable.versionCount > 1 ? (
                      <Badge variant="outline">{deliverable.versionCount}</Badge>
                    ) : (
                      <span className="text-muted-foreground">1</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <a
                      href={deliverable.current.url}
                      download={deliverable.current.filename}
                      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <DownloadIcon className="size-3.5" />
                      Download
                    </a>
                  </TableCell>
                </TableRow>,
                <TableRow key={`${rowKey}-detail`} className="hover:bg-transparent">
                  <TableCell colSpan={6} className="pt-0">
                    {/* Plain <details>: the history and the thread are
                        secondary to the list, and this needs no client state
                        to stay closed until an organizer asks for it. */}
                    <details className="group">
                      <summary className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Versions and comments
                        {thread.length > 0 ? ` (${thread.length})` : ""}
                      </summary>
                      <div className="mt-3 flex flex-col gap-4 rounded-md border border-border p-3">
                        <FileVersionList
                          versions={deliverable.older}
                          timeZone={event.timezone}
                        />
                        <FileCommentThread
                          comments={thread}
                          timeZone={event.timezone}
                          action={postDeliverableComment.bind(
                            null,
                            eventSlug,
                            deliverable.assignmentId,
                          )}
                          placeholder="Ask for a change, or note what you did with this file…"
                        />
                      </div>
                    </details>
                  </TableCell>
                </TableRow>,
              ];
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
