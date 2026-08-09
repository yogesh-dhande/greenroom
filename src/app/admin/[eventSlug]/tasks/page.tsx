import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { TasksManager } from "./tasks-manager";

/** Admin task templates for an event (spec.md §6, §8): what onboarding jobs
 * exist, and whether they auto-assign the moment a submission is accepted.
 * Admin-only (decisions.md D-047) — not part of a reviewer's event workspace. */
export default async function TasksPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const [tasks, forms, assignments, sessions] = await Promise.all([
    repos.tasks.listByEvent(event.id),
    repos.forms.listByEvent(event.id),
    repos.taskAssignments.listByEvent(event.id),
    repos.sessions.listByEvent(event.id),
  ]);

  const assignmentCounts: Record<string, number> = {};
  for (const assignment of assignments) {
    assignmentCounts[assignment.taskId] = (assignmentCounts[assignment.taskId] ?? 0) + 1;
  }

  // "Confirmed" mirrors the speakers roster (decisions.md D-017,
  // src/app/admin/[eventSlug]/speakers/page.tsx): every speaker who appears
  // on any session for this event, whatever put them there — acceptance
  // conversion or direct entry. This is what "Assign to confirmed speakers"
  // (D-052) targets, so the row can show the zero-state once everyone
  // confirmed already has the task.
  const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
    sessions.map((session) => session.id),
  );
  const confirmedSpeakerCount = new Set(sessionSpeakerRows.map((row) => row.userId)).size;

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Onboarding jobs assigned to accepted speakers — forms, uploads, confirmations."
      />
      <TasksManager
        eventSlug={eventSlug}
        eventTimezone={event.timezone}
        tasks={tasks}
        forms={forms}
        assignmentCounts={assignmentCounts}
        confirmedSpeakerCount={confirmedSpeakerCount}
      />
    </div>
  );
}
