import Link from "next/link";
import { DownloadIcon, PaperclipIcon } from "lucide-react";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import {
  buildCommentThread,
  deliverableSessionScope,
  formatFileMoment,
} from "@/domain/files";
import { NO_FILES_MESSAGE } from "@/domain/file-export";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { FileCommentThread, FileVersionList } from "@/components/file-thread";
import { postDeliverableComment } from "./actions";
import { loadFileLibrary } from "./data";
import { VersionsDisclosure } from "./versions-disclosure";
import { FileExportControls } from "./file-export-controls";

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
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { eventSlug } = await params;
  const requestedSessionId = (await searchParams).session;
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const {
    deliverables: allDeliverables,
    commentsByAssignment,
    peopleById,
    sessionTitlesBySpeaker,
    sessionRefsBySpeaker,
    sessions,
    speakerIdsBySession,
  } =
    await loadFileLibrary(repos, event.id);

  const selectedSession = requestedSessionId
    ? (sessions.find((session) => session.id === requestedSessionId) ?? null)
    : null;
  const selectedSpeakerIds = selectedSession
    ? new Set(speakerIdsBySession.get(selectedSession.id) ?? [])
    : null;
  const deliverables = selectedSpeakerIds
    ? allDeliverables.filter((deliverable) => selectedSpeakerIds.has(deliverable.speakerId))
    : allDeliverables;

  const exportable = deliverables.filter((deliverable) => deliverable.current.key !== null);
  const exportFormId = "file-export";

  return (
    <div>
      <PageHeader
        title="Files"
        description="Every deliverable your speakers have uploaded — decks, headshots, paperwork — with what each one replaced and the conversation about it."
        action={
          exportable.length > 0 ? (
            <FileExportControls formId={exportFormId} total={exportable.length} />
          ) : (
            <span className="text-sm text-muted-foreground" title={NO_FILES_MESSAGE}>
              No files to export
            </span>
          )
        }
      />

      {selectedSession ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p>
            Showing speaker-owned files related to <span className="font-medium">{selectedSession.title}</span>.
          </p>
          <Link
            href={`/admin/${eventSlug}/files`}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Show all files
          </Link>
        </div>
      ) : null}

      <form
        id={exportFormId}
        method="post"
        action={`/admin/${eventSlug}/files/download-all`}
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
              <TableHead className="w-10">Export</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Speaker</TableHead>
              <TableHead>Session scope</TableHead>
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
              const uploader = deliverable.current.uploadedBy
                ? peopleById.get(deliverable.current.uploadedBy)
                : undefined;
              const sessionScope = deliverableSessionScope(
                deliverable.source,
                sessionTitlesBySpeaker.get(deliverable.speakerId) ?? [],
              );
              const sessionRefs = sessionRefsBySpeaker.get(deliverable.speakerId) ?? [];
              // Keyed on the speaker as well as the assignment: profile rows
              // carry no assignment id, so two speakers' headshots would
              // otherwise collide on one key.
              const rowKey = `${deliverable.assignmentId ?? `profile-${deliverable.speakerId}`}-${deliverable.label}`;

              return [
                <TableRow key={rowKey} className="border-b-0">
                  <TableCell>
                    {deliverable.current.key ? (
                      <input
                        type="checkbox"
                        name="file"
                        value={deliverable.selectionId}
                        form={exportFormId}
                        defaultChecked
                        aria-label={`Select ${deliverable.current.filename}`}
                        className="size-4 accent-primary"
                      />
                    ) : null}
                  </TableCell>
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
                  <TableCell className="max-w-64 text-sm text-muted-foreground" title={sessionScope.description}>
                    {deliverable.source === "profile" || sessionRefs.length === 0 ? (
                      sessionScope.label
                    ) : (
                      <span className="flex flex-col items-start gap-1">
                        {sessionRefs.map((session) => (
                          <Link
                            key={session.id}
                            href={`/admin/${eventSlug}/agenda?session=${session.id}`}
                            className="line-clamp-1 text-foreground underline-offset-4 hover:underline"
                          >
                            {session.title}
                          </Link>
                        ))}
                        {sessionRefs.length > 1 ? (
                          <span className="text-xs">Speaker-wide task · {sessionRefs.length} sessions</span>
                        ) : null}
                      </span>
                    )}
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
                    ) : (
                      <span className="block text-xs">Uploader not recorded (legacy upload)</span>
                    )}
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
                    <TableCell colSpan={8} className="pt-0">
                      {/* The history and thread are secondary to the list, so
                          they stay collapsed behind a real button until an
                          organizer asks for them (needs no server round trip
                          to open, hence the tiny client component). */}
                      <VersionsDisclosure
                        label={
                          deliverable.assignmentId === null
                            ? "Earlier versions"
                            : `Versions and comments${thread.length > 0 ? ` (${thread.length})` : ""}`
                        }
                      >
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
                      </VersionsDisclosure>
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
