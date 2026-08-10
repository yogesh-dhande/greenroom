import Link from "next/link";
import { UserRoundIcon } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getRepos } from "@/lib/db";
import { isScheduled, type Event } from "@/db/entities";
import { buildAssignmentViews, nextDueAssignmentId, sortAssignmentViews } from "@/domain/onboarding";
import { buildCommentThread, buildFileHistory, groupByAssignment } from "@/domain/files";
import { speakerFacingStatus } from "@/domain/evaluation";
import { formatEventWhen } from "@/lib/event-time";
import { CompletionMeter } from "@/components/completion-meter";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { TaskItem } from "./task-item";

/**
 * Speaker portal home (spec.md §6): every event the speaker has a stake in —
 * a submission, a session, or an onboarding task — grouped so each shows its
 * own submissions/sessions/tasks together rather than one flat list.
 *
 * Submissions link straight to the existing `/portal/submissions/[id]` edit
 * page (W3a/W4a's — not rebuilt here); tasks render inline via TaskItem,
 * which reuses the same SchemaForm/upload machinery as a CFP submission.
 */
export default async function PortalHomePage() {
  const user = await requireUser("/portal");
  const repos = await getRepos();

  const [submissions, sessions, assignments] = await Promise.all([
    repos.submissions.listBySpeaker(user.id),
    repos.sessions.listBySpeaker(user.id),
    repos.taskAssignments.listBySpeaker(user.id),
  ]);

  const taskIds = Array.from(new Set(assignments.map((assignment) => assignment.taskId)));
  const tasks = await repos.tasks.listByIds(taskIds);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  // Upload history and comment threads for every task the speaker holds
  // (decisions.md D-054) — two batched queries, not one per card.
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [fileVersions, fileComments] = await Promise.all([
    repos.fileVersions.listByAssignments(assignmentIds),
    repos.fileComments.listByAssignments(assignmentIds),
  ]);
  const versionsByAssignment = groupByAssignment(fileVersions);
  const commentsByAssignment = groupByAssignment(fileComments);
  const commentAuthors = await repos.users.listByIds(
    Array.from(new Set(fileComments.map((comment) => comment.authorId))),
  );
  const authorsById = new Map(commentAuthors.map((author) => [author.id, author]));

  const formIds = Array.from(
    new Set(
      tasks
        .filter((task) => task.type === "form" && task.formId)
        .map((task) => task.formId as string),
    ),
  );
  const eventIds = Array.from(
    new Set([
      ...submissions.map((submission) => submission.eventId),
      ...sessions.map((session) => session.eventId),
      ...tasks.map((task) => task.eventId),
    ]),
  );

  // Batched, not one query per id: a speaker with a handful of events and
  // tasks used to issue a D1 round trip per form, per event, and per event's
  // rooms, and those loops are the first thing to hurt once a portal has real
  // data in it.
  const [forms, eventRows] = await Promise.all([
    repos.forms.listByIds(formIds),
    repos.events.listByIds(eventIds),
  ]);
  const formsById = new Map(forms.map((form) => [form.id, form]));

  const eventsById = new Map(eventRows.map((event) => [event.id, event]));
  const events = eventIds
    .map((id) => eventsById.get(id))
    .filter((event): event is Event => event !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  const rooms = await repos.rooms.listByEvents(events.map((event) => event.id));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));

  const views = sortAssignmentViews(buildAssignmentViews(assignments, tasksById));
  // The one task the speaker should land on expanded — across every event,
  // not per section, so the whole page opens on a single next step (W25 4A).
  const nextDueId = nextDueAssignmentId(views);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Your speaker home" description={`Signed in as ${user.email}`} />

      {/* Profile lives outside any one event, so it gets its own card rather
          than a slot inside an event section (spec.md §6 — the profile editor
          must be reachable from portal navigation, not just by URL). */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserRoundIcon className="size-8 shrink-0 rounded-full bg-muted p-1.5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Your profile</p>
              <p className="text-sm text-muted-foreground">
                Bio, headshot, and links — shown on the admin roster and public speaker gallery.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/portal/profile">Edit your profile</Link>
          </Button>
        </CardContent>
      </Card>

      {events.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Once you submit a talk or an organizer adds you to an event, it'll show up here."
        />
      ) : (
        events.map((event) => {
          const eventSubmissions = submissions.filter((submission) => submission.eventId === event.id);
          const eventSessions = sessions.filter((session) => session.eventId === event.id);
          const eventViews = views.filter((view) => view.task.eventId === event.id);

          return (
            <section key={event.id} className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{event.name}</h2>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Your submissions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {eventSubmissions.length === 0 ? (
                      <EmptyState
                        variant="inline"
                        title="Nothing submitted yet."
                        description="Talks you submit to a call for speakers will show up here."
                      />
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {eventSubmissions.map((submission) => (
                          <li key={submission.id}>
                            <Link
                              href={`/portal/submissions/${submission.id}`}
                              className="flex items-center justify-between gap-3 rounded-md border border-border p-3 hover:bg-muted/40"
                            >
                              <span className="text-sm font-medium text-foreground">{submission.title}</span>
                              <SubmissionStatusBadge status={speakerFacingStatus(submission.status)} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Your sessions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {eventSessions.length === 0 ? (
                      <EmptyState
                        variant="inline"
                        title="No sessions yet."
                        description="Accepted talks turn into scheduled sessions here."
                      />
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {eventSessions.map((session) => {
                          const room = session.roomId ? roomsById.get(session.roomId) : undefined;
                          return (
                            <li key={session.id} className="rounded-md border border-border p-3">
                              <p className="text-sm font-medium text-foreground">{session.title}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {isScheduled(session)
                                  ? formatEventWhen(
                                      session.day as string,
                                      session.startTime as string,
                                      session.endTime as string,
                                      event.timezone,
                                    )
                                  : "Not yet scheduled"}
                                {room ? ` — ${room.name}` : ""}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Your tasks</CardTitle>
                  {/* The same meter an organizer sees against this speaker on
                      the roster, so "how far along am I" reads identically on
                      both sides of the event. */}
                  {eventViews.length > 0 ? (
                    <CardAction>
                      <CompletionMeter
                        done={eventViews.filter((view) => view.state === "complete").length}
                        total={eventViews.length}
                      />
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {eventViews.length === 0 ? (
                    <EmptyState
                      variant="inline"
                      title="Nothing to do yet."
                      description="Onboarding tasks — forms, uploads, confirmations — will appear here."
                    />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {eventViews.map((view) => (
                        <TaskItem
                          key={view.assignment.id}
                          assignment={view.assignment}
                          task={view.task}
                          state={view.state}
                          form={view.task.formId ? (formsById.get(view.task.formId) ?? null) : null}
                          history={buildFileHistory(
                            view.assignment,
                            versionsByAssignment.get(view.assignment.id) ?? [],
                          )}
                          comments={buildCommentThread(
                            commentsByAssignment.get(view.assignment.id) ?? [],
                            authorsById,
                          )}
                          timeZone={event.timezone}
                          startExpanded={view.assignment.id === nextDueId}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          );
        })
      )}
    </div>
  );
}
