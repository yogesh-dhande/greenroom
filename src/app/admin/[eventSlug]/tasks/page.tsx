import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { loadSpeakerRoster } from "../speakers/roster";
import { TasksManager } from "./tasks-manager";
import type { TaskSpeakerOption } from "./types";

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
  const [tasks, forms, assignments, roster] = await Promise.all([
    repos.tasks.listByEvent(event.id),
    repos.forms.listByEvent(event.id),
    repos.taskAssignments.listByEvent(event.id),
    // The same roster the Speakers pages read, so "who can I give this task
    // to" and "who is on this event" can't disagree (decisions.md D-069).
    loadSpeakerRoster(repos, event.id),
  ]);

  const assignmentCounts: Record<string, number> = {};
  // Who already holds each task — what the dialog ticks and locks, so an
  // edit can add assignees without offering to remove existing work.
  const assignedSpeakerIdsByTask: Record<string, string[]> = {};
  for (const assignment of assignments) {
    assignmentCounts[assignment.taskId] = (assignmentCounts[assignment.taskId] ?? 0) + 1;
    (assignedSpeakerIdsByTask[assignment.taskId] ??= []).push(assignment.speakerId);
  }

  const speakers: TaskSpeakerOption[] = roster.rollups.map((rollup) => ({
    id: rollup.speaker.id,
    name: rollup.speaker.name ?? rollup.speaker.email,
    email: rollup.speaker.email,
    confirmed: rollup.confirmed,
  }));

  // "Confirmed" is the *effective* status the roster already resolved
  // (decisions.md D-068, `resolveConfirmation`): the organizer's stored
  // answer when there is one, else whether they're on any session for this
  // event (D-017). This is what "Assign to confirmed speakers" (D-052)
  // targets, so a speaker explicitly marked Declined doesn't count toward
  // the row's total or get caught by the zero-state, even if they're still
  // attached to a session the organizer hasn't unpicked yet.
  const confirmedSpeakerCount = roster.rollups.filter((rollup) => rollup.confirmed).length;

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
        speakers={speakers}
        assignedSpeakerIdsByTask={assignedSpeakerIdsByTask}
        assignmentCounts={assignmentCounts}
        confirmedSpeakerCount={confirmedSpeakerCount}
      />
    </div>
  );
}
