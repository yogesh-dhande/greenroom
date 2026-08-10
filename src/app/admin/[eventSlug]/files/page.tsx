import Link from "next/link";
import { DownloadIcon, PackageIcon, PaperclipIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { buildCommentThread, formatFileMoment } from "@/domain/files";
import { NO_FILES_MESSAGE } from "@/domain/file-export";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { FileCommentThread, FileVersionList } from "@/components/file-thread";
import { postDeliverableComment } from "./actions";
import { loadFileLibrary } from "./data";

/**
 * Every file the event's speakers have sent in, in one place (spec.md §6,
 * decisions.md D-054 — the central files library).
 *
 * The rows come from `collectDeliverables`, the same collector the portal
 * uses, so an upload can't be visible on one surface and missing on the
 * other: a `file_request` assignment's own upload and a `form` task's file
 * answers both land here, alongside the profile files (headshots) tracked
 * against the speaker rather than against a task. Each row expands to what it
 * replaced and, for a task file, to the comment thread the speaker sees on
 * their task card.
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
  const { deliverables, commentsByAssignment, peopleById, sessionTitlesBySpeaker } =
    await loadFileLibrary(repos, event.id);

  // "Download all" streams exactly these rows' current files (D-073). With
  // nothing uploaded there is nothing to archive, so the control says so
  // rather than handing over an empty ZIP.
  const canDownloadAll = deliverables.some((deliverable) => deliverable.current.key !== null);

  return (
    <div>
      <PageHeader
        title="Files"
        description="Every deliverable your speakers have uploaded — decks, headshots, paperwork — with what each one replaced and the conversation about it."
        action={
          canDownloadAll ? (
            <Button asChild variant="outline">
              <Link href={`/admin/${eventSlug}/files/download-all`}>
                <PackageIcon className="size-3.5" />
                Download all
              </Link>
            </Button>
          ) : (
            <Button variant="outline" disabled title={NO_FILES_MESSAGE}>
              <PackageIcon className="size-3.5" />
              Download all
            </Button>
          )
        }
      />

      {deliverables.length === 0 ? (
        <EmptyState
          title="Nothing uploaded yet"
          description="Files speakers upload — for an onboarding task or on their profile — land here, with what they belong to, who sent them, and every earlier version."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Speaker</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Versions</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliverables.map((deliverable) => {
              const speaker = peopleById.get(deliverable.speakerId);
              // Comments hang off an assignment, so a profile file has no
              // thread to show and no assignment to post one against.
              const thread = deliverable.assignmentId
                ? buildCommentThread(
                    commentsByAssignment.get(deliverable.assignmentId) ?? [],
                    peopleById,
                  )
                : [];
              const uploader =
                deliverable.current.uploadedBy && deliverable.current.uploadedBy !== deliverable.speakerId
                  ? peopleById.get(deliverable.current.uploadedBy)
                  : undefined;
              // Keyed on the speaker as well as the assignment: profile rows
              // carry no assignment id, so two speakers' headshots would
              // otherwise collide on one key.
              const rowKey = `${deliverable.assignmentId ?? `profile-${deliverable.speakerId}`}-${deliverable.label}`;

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
                  <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                    {sessionTitlesBySpeaker.get(deliverable.speakerId)?.join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {deliverable.label}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatFileMoment(deliverable.current.uploadedAt, event.timezone)}
                    {uploader ? (
                      <span className="block text-xs">
                        by {uploader.name ?? uploader.email}
                      </span>
                    ) : null}
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
                // A profile file with nothing behind it has neither history
                // nor a thread, so it gets no expander at all.
                deliverable.assignmentId === null && deliverable.older.length === 0 ? null : (
                  <TableRow key={`${rowKey}-detail`} className="hover:bg-transparent">
                    <TableCell colSpan={7} className="pt-0">
                      {/* Plain <details>: the history and the thread are
                          secondary to the list, and this needs no client state
                          to stay closed until an organizer asks for it. */}
                      <details className="group">
                        <summary className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          {deliverable.assignmentId === null
                            ? "Earlier versions"
                            : `Versions and comments${thread.length > 0 ? ` (${thread.length})` : ""}`}
                        </summary>
                        <div className="mt-3 flex flex-col gap-4 rounded-md border border-border p-3">
                          <FileVersionList
                            versions={deliverable.older}
                            timeZone={event.timezone}
                          />
                          {deliverable.assignmentId === null ? null : (
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
                          )}
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                ),
              ];
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
