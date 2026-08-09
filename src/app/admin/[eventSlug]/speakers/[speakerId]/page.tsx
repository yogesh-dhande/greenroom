import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import type { Form } from "@/db/entities";
import { isScheduled } from "@/db/entities";
import {
  otherSpeakersWithSameName,
  TASK_STATE_LABEL,
  type AssignmentView,
  type TaskState,
} from "@/domain/onboarding";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { fileUrl, filenameFromKey, isImageKey, keyFromFileUrl } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { formatDay, formatTime } from "@/components/date-format";
import { formatDueDate } from "@/lib/event-time";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EMAIL_KIND_LABELS } from "../../communications/types";
import { loadSpeakerRoster } from "../roster";
import { SpeakerHeadshotForm } from "./speaker-headshot-form";
import { SpeakerNotesForm } from "./speaker-notes-form";
import { SpeakerProfileForm } from "./speaker-profile-form";

/** Most recent sends shown before the list collapses to "…and N older" —
 * a speaker who's been through a few events can otherwise produce a card
 * that's mostly scroll. */
const EMAIL_HISTORY_LIMIT = 20;

/** Same task-state palette as the roster (decisions.md D-018 semantic tokens). */
const STATE_BADGE_CLASS: Record<TaskState, string> = {
  complete: "border-border text-muted-foreground",
  open: "border-border text-foreground",
  due_soon: "border-warning bg-warning/10 text-warning",
  overdue: "border-destructive bg-destructive/10 text-destructive",
};

interface SpeakerUpload {
  /** Stored object key, or null for a value that was saved as an absolute
   * URL elsewhere (an imported headshot, for instance). */
  key: string | null;
  url: string;
  filename: string;
  uploadedAt: Date;
  /** Which task produced the file. */
  label: string;
}

/**
 * Everything this speaker has sent in, from both places a task can hold a
 * file: a `file_request` assignment stores the served URL on the assignment,
 * while a `form` task's answers hold the raw object key under the form's file
 * fields (spec.md §6). Both end up as a filename, a date, and a link.
 */
function collectUploads(views: AssignmentView[], formsById: Map<string, Form>): SpeakerUpload[] {
  const uploads: SpeakerUpload[] = [];

  for (const { assignment, task } of views) {
    const uploadedAt = assignment.completedAt ?? assignment.updatedAt;

    if (assignment.fileUrl) {
      const key = keyFromFileUrl(assignment.fileUrl);
      uploads.push({
        key,
        url: assignment.fileUrl,
        filename: key ? filenameFromKey(key) : assignment.fileUrl.split("/").pop() || "File",
        uploadedAt,
        label: task.title,
      });
    }

    const form = task.formId ? formsById.get(task.formId) : undefined;
    if (!form || !assignment.responseJson) continue;
    for (const field of form.fields) {
      if (field.type !== "file") continue;
      const value = assignment.responseJson[field.id];
      if (typeof value !== "string" || value === "") continue;
      uploads.push({
        key: value,
        url: fileUrl(value),
        filename: filenameFromKey(value),
        uploadedAt,
        label: `${task.title} — ${field.label}`,
      });
    }
  }

  return uploads.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

/**
 * One speaker's record (spec.md §5, decisions.md D-051): profile, the sessions
 * they're on, their onboarding tasks with per-task status, what they've
 * uploaded, and the organizer's private logistics notes.
 *
 * Admin-only, like the roster it hangs off (decisions.md D-047). Event scoping
 * is the roster itself: `loadSpeakerRoster` resolves membership from sessions,
 * task assignments and `event_speakers`, so a user id that belongs to another
 * event's roster — or to no roster at all — is simply not found here.
 *
 * Assigning a task from this page is deliberately absent: task assignment is
 * D-052's, on the tasks list. This page reports status, it doesn't create it.
 */
export default async function SpeakerRecordPage({
  params,
}: {
  params: Promise<{ eventSlug: string; speakerId: string }>;
}) {
  const { eventSlug, speakerId } = await params;
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const [{ rollups, sessionsBySpeaker, notesBySpeaker }, forms] = await Promise.all([
    loadSpeakerRoster(repos, event.id),
    repos.forms.listByEvent(event.id),
  ]);

  const rollup = rollups.find((candidate) => candidate.speaker.id === speakerId);
  if (!rollup) notFound();

  const speaker = rollup.speaker;
  const sessions = sessionsBySpeaker.get(speaker.id) ?? [];
  const uploads = collectUploads(
    rollup.views,
    new Map(forms.map((form) => [form.id, form])),
  );
  const headshotKey = speaker.headshotUrl ? keyFromFileUrl(speaker.headshotUrl) : null;

  // Other roster entries sharing this speaker's display name (decisions.md
  // D-059).
  const duplicates = otherSpeakersWithSameName(rollups, speaker.id);

  // `email_log` is keyed by address, not by event (see EmailLogRepo's
  // listByRecipient doc) — mail this speaker was sent for *any* event they've
  // spoken at shows up here, not just this one. That's deliberate: the same
  // person's inbox doesn't reset between events. The d1 repo already orders
  // newest-first, so no re-sort is needed here.
  const emailHistory = await repos.emailLog.listByRecipient(speaker.email);
  const emailHistoryShown = emailHistory.slice(0, EMAIL_HISTORY_LIMIT);
  const emailHistoryOlderCount = emailHistory.length - emailHistoryShown.length;

  return (
    <div>
      <Link
        href={`/admin/${eventSlug}/speakers`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All speakers
      </Link>

      <PageHeader
        title={speaker.name ?? speaker.email}
        description={speaker.email}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={rollup.confirmed ? "default" : "outline"}>
              {rollup.confirmed ? "Confirmed" : "Not confirmed"}
            </Badge>
            {rollup.overdueTasks > 0 ? (
              <Badge variant="outline" className="border-destructive bg-destructive/10 text-destructive">
                {rollup.overdueTasks} overdue
              </Badge>
            ) : null}
          </div>
        }
      />

      {duplicates.length > 0 ? (
        // Same hazard the roster badge flags (decisions.md D-059), but with
        // follow-through: the roster's badge had no way to actually see the
        // colliding record, which is what this card fixes. Display only — no
        // merge/link action, per D-059 and D-065.
        <Card className="mb-4 border-warning bg-warning/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="outline" className="border-warning bg-warning/10 text-warning">
                Possible duplicate
              </Badge>
            </CardTitle>
            <CardDescription>
              Another roster entry uses the same display name as this speaker. These are distinct
              speaker records that happen to share a name — open the record below to compare
              before assuming they&apos;re the same person.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {duplicates.map((other) => (
                <li key={other.id}>
                  <Link
                    href={`/admin/${eventSlug}/speakers/${other.id}`}
                    className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {other.name ?? other.email}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{other.email}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                What the public speaker page and speaker emails use. The speaker can edit the same
                fields — plus their links — in their portal; you can also supply a headshot on
                their behalf below.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start gap-4">
                {speaker.headshotUrl && (!headshotKey || isImageKey(headshotKey)) ? (
                  // A small fixed-size avatar of an unknown-at-build-time URL
                  // (an uploaded /files/<key> or an imported absolute one), so
                  // next/image buys nothing here — same call as the portal's
                  // own profile page.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={speaker.headshotUrl}
                    alt={`${speaker.name ?? speaker.email}'s headshot`}
                    className="size-16 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground">
                    No photo
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    {speaker.headshotUrl
                      ? "Headshot on file. Upload a new image to replace it."
                      : "No headshot yet — upload one here, or the speaker can add it from their portal profile."}
                  </p>
                  <SpeakerHeadshotForm eventSlug={eventSlug} speakerId={speaker.id} />
                </div>
              </div>

              <SpeakerProfileForm eventSlug={eventSlug} speaker={speaker} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>Everything they&apos;re speaking on at this event.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sessions yet. Accepting one of their proposals creates the session record.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {sessions.map((session) => (
                    <li key={session.id} className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{session.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {isScheduled(session)
                          ? `${formatDay(session.day!, true)} · ${formatTime(session.startTime!)}–${formatTime(session.endTime!)}`
                          : "Not scheduled yet"}
                        {session.status !== "confirmed" ? ` · ${session.status}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Onboarding tasks</CardTitle>
              <CardDescription>
                {rollup.totalTasks === 0
                  ? "Nothing assigned yet — tasks are assigned from the Tasks page."
                  : `${rollup.completedTasks} of ${rollup.totalTasks} done (${rollup.completionPercent}%).`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rollup.views.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {rollup.views.map((view) => (
                    <li
                      key={view.assignment.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {view.task.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {view.task.dueAt
                            ? `Due ${formatDueDate(view.task.dueAt, event.timezone)}`
                            : "No due date"}
                          {view.assignment.completedAt
                            ? ` · completed ${formatDueDate(view.assignment.completedAt, event.timezone)}`
                            : ""}
                        </span>
                      </div>
                      <Badge variant="outline" className={cn(STATE_BADGE_CLASS[view.state])}>
                        {TASK_STATE_LABEL[view.state]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Uploads</CardTitle>
              <CardDescription>Files they&apos;ve sent in through their tasks.</CardDescription>
            </CardHeader>
            <CardContent>
              {uploads.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {uploads.map((upload) => (
                    <li key={upload.url} className="flex items-center gap-3">
                      {upload.key && isImageKey(upload.key) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={upload.url}
                          alt=""
                          className="size-10 shrink-0 rounded-md object-cover"
                        />
                      ) : null}
                      <div className="flex min-w-0 flex-col">
                        <a
                          href={upload.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-sm text-primary underline-offset-4 hover:underline"
                        >
                          {upload.filename}
                        </a>
                        <span className="text-xs text-muted-foreground">
                          {upload.label} · {formatDueDate(upload.uploadedAt, event.timezone)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Internal notes</CardTitle>
              <CardDescription>
                Logistics for this event only — travel, seating, dietary needs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SpeakerNotesForm
                eventSlug={eventSlug}
                speakerId={speaker.id}
                notes={notesBySpeaker.get(speaker.id) ?? null}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email history</CardTitle>
              <CardDescription>
                Mail sent to {speaker.email}. Logged by address rather than by event, so this
                includes messages from any event they&apos;ve spoken at, not just this one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {emailHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No email logged for this address yet.</p>
              ) : (
                <>
                  <ul className="flex flex-col gap-3">
                    {emailHistoryShown.map((log) => (
                      <li key={log.id} className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{log.subject}</span>
                          {log.status === "sent" ? (
                            <span className="text-xs text-muted-foreground">Sent</span>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-destructive bg-destructive/10 text-destructive"
                              title={log.error ?? undefined}
                            >
                              Failed
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {EMAIL_KIND_LABELS[log.kind]} · {formatDueDate(log.sentAt, event.timezone)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {emailHistoryOlderCount > 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      …and {emailHistoryOlderCount} older
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
