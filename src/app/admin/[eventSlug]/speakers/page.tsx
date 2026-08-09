import { notFound } from "next/navigation";
import type { TaskAssignment } from "@/db/entities";
import { getRepos } from "@/lib/db";
import { buildSpeakerRollups, sortSpeakerRollups, TASK_STATE_LABEL, type TaskState } from "@/domain/onboarding";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/** Per-task-state badge styling. `warning` is the shared semantic token for
 * anything due soon (decisions.md D-018) — never a raw amber class. */
const STATE_BADGE_CLASS: Record<TaskState, string> = {
  complete: "border-border text-muted-foreground",
  open: "border-border text-foreground",
  due_soon: "border-warning bg-warning/10 text-warning",
  overdue: "border-destructive bg-destructive/10 text-destructive",
};

/**
 * Per-event onboarding dashboard (spec.md §8): who's confirmed to speak, and
 * how their onboarding tasks are going — outstanding/overdue counts and a
 * completion percentage, at a glance, in one table.
 *
 * "Confirmed" mirrors the acceptance rule from decisions.md D-017: acceptance
 * auto-creates the session record (even before it's scheduled), so having any
 * session row for this event is what confirmed means — that also covers a
 * speaker entered directly (e.g. a sponsor) with no CFP submission at all.
 */
export default async function SpeakersPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const [sessions, tasks, assignments] = await Promise.all([
    repos.sessions.listByEvent(event.id),
    repos.tasks.listByEvent(event.id),
    repos.taskAssignments.listByEvent(event.id),
  ]);

  const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
    sessions.map((session) => session.id),
  );
  const confirmedSpeakerIds = new Set(sessionSpeakerRows.map((row) => row.userId));

  const assignmentsBySpeaker = new Map<string, TaskAssignment[]>();
  for (const assignment of assignments) {
    const list = assignmentsBySpeaker.get(assignment.speakerId) ?? [];
    list.push(assignment);
    assignmentsBySpeaker.set(assignment.speakerId, list);
  }

  // Every speaker with a stake in this event: confirmed to speak, or holding
  // at least one task assignment (e.g. before their session is scheduled).
  const speakerIds = new Set<string>([...confirmedSpeakerIds, ...assignmentsBySpeaker.keys()]);
  const speakers = await repos.users.listByIds(Array.from(speakerIds));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  const rollups = sortSpeakerRollups(
    buildSpeakerRollups({ speakers, confirmedSpeakerIds, assignmentsBySpeaker, tasksById }),
  );

  return (
    <div>
      <PageHeader
        title="Speakers"
        description="Who's confirmed, and how their onboarding tasks are going."
      />

      {rollups.length === 0 ? (
        <EmptyState
          title="No speakers yet"
          description="Accepting a submission automatically creates the speaker record here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Speaker</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>Completion</TableHead>
              <TableHead>Overdue</TableHead>
              <TableHead>Tasks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rollups.map((rollup) => (
              <TableRow key={rollup.speaker.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {rollup.speaker.name ?? rollup.speaker.email}
                    </span>
                    <span className="text-xs text-muted-foreground">{rollup.speaker.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={rollup.confirmed ? "default" : "outline"}>
                    {rollup.confirmed ? "Confirmed" : "Not yet"}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {rollup.totalTasks === 0
                    ? "No tasks"
                    : `${rollup.completedTasks}/${rollup.totalTasks} (${rollup.completionPercent}%)`}
                </TableCell>
                <TableCell>
                  {rollup.overdueTasks > 0 ? (
                    <Badge variant="outline" className="border-destructive bg-destructive/10 text-destructive">
                      {rollup.overdueTasks}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {rollup.views.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {rollup.views.map((view) => (
                        <Badge
                          key={view.assignment.id}
                          variant="outline"
                          className={cn(STATE_BADGE_CLASS[view.state])}
                          title={TASK_STATE_LABEL[view.state]}
                        >
                          {view.task.title}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
