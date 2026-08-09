import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getRepos } from "@/lib/db";
import { isScheduled, type Event, type Form, type Room } from "@/db/entities";
import { buildAssignmentViews, sortAssignmentViews } from "@/domain/onboarding";
import { speakerFacingStatus } from "@/domain/evaluation";
import { formatEventWhen } from "@/lib/event-time";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const formIds = Array.from(
    new Set(
      tasks
        .filter((task) => task.type === "form" && task.formId)
        .map((task) => task.formId as string),
    ),
  );
  const forms = await Promise.all(formIds.map((id) => repos.forms.getById(id)));
  const formsById = new Map(forms.filter((form): form is Form => form !== null).map((form) => [form.id, form]));

  const eventIds = Array.from(
    new Set([
      ...submissions.map((submission) => submission.eventId),
      ...sessions.map((session) => session.eventId),
      ...tasks.map((task) => task.eventId),
    ]),
  );
  const events = (await Promise.all(eventIds.map((id) => repos.events.getById(id))))
    .filter((event): event is Event => event !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const roomLists = await Promise.all(events.map((event) => repos.rooms.listByEvent(event.id)));
  const roomsById = new Map<string, Room>();
  for (const rooms of roomLists) {
    for (const room of rooms) roomsById.set(room.id, room);
  }

  const views = sortAssignmentViews(buildAssignmentViews(assignments, tasksById));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Your speaker home" description={`Signed in as ${user.email}`} />

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
                        title="Nothing submitted yet"
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
                        title="No sessions yet"
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
                </CardHeader>
                <CardContent>
                  {eventViews.length === 0 ? (
                    <EmptyState
                      title="Nothing to do yet"
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
