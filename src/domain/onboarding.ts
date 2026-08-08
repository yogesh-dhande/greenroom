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
 * own task list and the organizer dashboard's per-speaker row. */
export function summarizeSpeakerOnboarding(
  userId: string,
  assignments: TaskAssignment[],
  now: Date = new Date(),
): SpeakerOnboardingStatus {
  // TODO: count assignments by status; "overdue" = incomplete AND its
  // task's dueDate < now (join against the corresponding Task via the
  // caller, since TaskAssignment doesn't carry dueDate directly).
  return {
    userId,
    totalTasks: assignments.length,
    completeTasks: 0,
    overdueTasks: 0,
    isComplete: assignments.length === 0,
  };
}

export interface OnboardingFilter {
  taskId?: string;
  trackId?: string;
  overdueOnly?: boolean;
}

/** Filters the organizer dashboard's speaker list (spec.md §6: "Filterable
 * by task, track, deadline"). */
export function filterOnboardingRows<T extends { userId: string; taskId: string }>(
  rows: T[],
  filter: OnboardingFilter,
): T[] {
  // TODO: apply taskId/trackId/overdueOnly filters. Track filtering
  // requires joining through the speaker's assigned session(s).
  return rows;
}

/** Transitions a task assignment's status, e.g. when a speaker completes
 * the form attached to a task (spec.md §2). */
export function completeTask(assignment: TaskAssignment, now: Date = new Date()): TaskAssignment {
  return { ...assignment, status: "complete" as TaskAssignmentStatus, completedAt: now };
}

/** True if `assignment` is incomplete and its task's deadline has passed —
 * the shared rule behind `overdueTasks` above and the dashboard's overdue
 * filter/reminder cron (src/domain/comms.ts). */
export function isOverdue(task: Task, assignment: TaskAssignment, now: Date = new Date()): boolean {
  return assignment.status !== "complete" && task.dueDate !== null && task.dueDate < now;
}
