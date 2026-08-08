/**
 * Onboarding domain service — per-speaker task status for the speaker
 * portal (spec.md §2) and the organizer onboarding dashboard (spec.md §6).
 * Pure TypeScript: no datastore imports.
 */
import type { Task, TaskAssignment, TaskAssignmentStatus } from "@/db/entities";

export interface SpeakerOnboardingStatus {
  userId: string;
  totalTasks: number;
  completeTasks: number;
  overdueTasks: number;
  isComplete: boolean;
}

/** Summarizes one speaker's onboarding progress — backs both the speaker's
 * own task list and the organizer dashboard's per-speaker row.
 *
 * `tasks` supplies the deadlines: a TaskAssignment carries no `dueAt` of its
 * own (the deadline belongs to the Task), so overdue counting needs the
 * caller to hand over the tasks those assignments point at. Assignments
 * whose task isn't in `tasks` simply never count as overdue. */
export function summarizeSpeakerOnboarding(
  userId: string,
  assignments: TaskAssignment[],
  tasks: Task[] = [],
  now: Date = new Date(),
): SpeakerOnboardingStatus {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  let completeTasks = 0;
  let overdueTasks = 0;
  for (const assignment of assignments) {
    if (assignment.status === "completed") {
      completeTasks += 1;
      continue;
    }
    const task = tasksById.get(assignment.taskId);
    if (task && isOverdue(task, assignment, now)) overdueTasks += 1;
  }

  return {
    userId,
    totalTasks: assignments.length,
    completeTasks,
    overdueTasks,
    isComplete: completeTasks === assignments.length,
  };
}

export interface OnboardingFilter {
  taskId?: string;
  trackId?: string;
  overdueOnly?: boolean;
}

/**
 * One row of the organizer onboarding dashboard: a (speaker, task) pair
 * plus the two attributes the dashboard filters on that can't be derived
 * from the pair alone. `trackIds` is denormalized by the caller (it comes
 * from the speaker's scheduled sessions, which the domain layer can't
 * query), and `overdue` is `isOverdue(task, assignment)` evaluated once.
 */
export interface OnboardingRow {
  userId: string;
  taskId: string;
  trackIds?: string[];
  overdue?: boolean;
}

/** Filters the organizer dashboard's speaker list (spec.md §6: "Filterable
 * by task, track, deadline"). */
export function filterOnboardingRows<T extends OnboardingRow>(
  rows: T[],
  filter: OnboardingFilter,
): T[] {
  return rows.filter((row) => {
    if (filter.taskId && row.taskId !== filter.taskId) return false;
    if (filter.trackId && !(row.trackIds ?? []).includes(filter.trackId)) return false;
    if (filter.overdueOnly && row.overdue !== true) return false;
    return true;
  });
}

/** Transitions a task assignment's status, e.g. when a speaker completes
 * the form attached to a task (spec.md §2). */
export function completeTask(assignment: TaskAssignment, now: Date = new Date()): TaskAssignment {
  return { ...assignment, status: "completed" as TaskAssignmentStatus, completedAt: now };
}

/** True if `assignment` is incomplete and its task's deadline has passed —
 * the shared rule behind `overdueTasks` above and the dashboard's overdue
 * filter/reminder cron (src/domain/comms.ts). */
export function isOverdue(task: Task, assignment: TaskAssignment, now: Date = new Date()): boolean {
  return assignment.status !== "completed" && task.dueAt !== null && task.dueAt < now;
}
