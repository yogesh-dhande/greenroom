/**
 * Speaker onboarding: task-state derivation and per-speaker rollups
 * (spec.md §6 speaker portal, §8 admin onboarding visibility).
 *
 * Pure, storage-agnostic logic in the same shape as src/domain/scheduling.ts:
 * everything here takes plain entity values in and returns plain values out
 * (no Repos, no I/O), so the portal home page and the admin onboarding
 * dashboard share one place that decides what "overdue" or "done" means.
 */
import type { Task, TaskAssignment, User } from "@/db/entities";

/** A task due within this many days (and not yet complete) is "due soon"
 * rather than plain "open" — the portal's cue to act before it's overdue. */
export const DUE_SOON_WINDOW_DAYS = 3;

export type TaskState = "complete" | "overdue" | "due_soon" | "open";

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  complete: "Complete",
  overdue: "Overdue",
  due_soon: "Due soon",
  open: "Open",
};

/**
 * Derives a task's display state from its assignment status and due date.
 *
 * A task with no due date can only ever be "open" or "complete" — there's
 * nothing to be overdue against.
 */
export function deriveTaskState(
  assignment: Pick<TaskAssignment, "status">,
  dueAt: Date | null,
  now: Date = new Date(),
): TaskState {
  if (assignment.status === "completed") return "complete";
  if (!dueAt) return "open";

  const msUntilDue = dueAt.getTime() - now.getTime();
  if (msUntilDue < 0) return "overdue";

  const soonWindowMs = DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return msUntilDue <= soonWindowMs ? "due_soon" : "open";
}

export interface AssignmentView {
  assignment: TaskAssignment;
  task: Task;
  state: TaskState;
}

/**
 * Pairs assignments with their task and derived state, dropping any
 * assignment whose task can't be resolved. Tasks aren't deletable once
 * assigned via the admin UI, but a rollup shouldn't crash if data drifts.
 */
export function buildAssignmentViews(
  assignments: TaskAssignment[],
  tasksById: Map<string, Task>,
  now: Date = new Date(),
): AssignmentView[] {
  const views: AssignmentView[] = [];
  for (const assignment of assignments) {
    const task = tasksById.get(assignment.taskId);
    if (!task) continue;
    views.push({ assignment, task, state: deriveTaskState(assignment, task.dueAt, now) });
  }
  return views;
}

const STATE_SORT_RANK: Record<TaskState, number> = {
  overdue: 0,
  due_soon: 1,
  open: 2,
  complete: 3,
};

/**
 * Most urgent first — overdue, then due-soon, then open, then complete —
 * with ties broken by due date (soonest first; undated tasks sort last
 * within their state).
 */
export function sortAssignmentViews(views: AssignmentView[]): AssignmentView[] {
  return [...views].sort((a, b) => {
    const rankDiff = STATE_SORT_RANK[a.state] - STATE_SORT_RANK[b.state];
    if (rankDiff !== 0) return rankDiff;
    const aDue = a.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = b.task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });
}

export interface SpeakerRollup {
  speaker: User;
  /** Has a session for this event — CFP-accepted or entered directly
   * (spec.md §8; D-017 — acceptance auto-creates the session record). */
  confirmed: boolean;
  totalTasks: number;
  completedTasks: number;
  outstandingTasks: number;
  overdueTasks: number;
  /** 0-100. A speaker with no assigned tasks is 100 — nothing outstanding,
   * not a red flag. */
  completionPercent: number;
  views: AssignmentView[];
}

export interface BuildSpeakerRollupsInput {
  speakers: User[];
  confirmedSpeakerIds: Set<string>;
  assignmentsBySpeaker: Map<string, TaskAssignment[]>;
  tasksById: Map<string, Task>;
  now?: Date;
}

/**
 * One row per speaker for the admin onboarding dashboard: who's confirmed,
 * how many tasks they have outstanding/overdue, and their completion %.
 */
export function buildSpeakerRollups(input: BuildSpeakerRollupsInput): SpeakerRollup[] {
  const now = input.now ?? new Date();
  return input.speakers.map((speaker) => {
    const assignments = input.assignmentsBySpeaker.get(speaker.id) ?? [];
    const views = sortAssignmentViews(buildAssignmentViews(assignments, input.tasksById, now));
    const totalTasks = views.length;
    const completedTasks = views.filter((view) => view.state === "complete").length;
    const overdueTasks = views.filter((view) => view.state === "overdue").length;
    const outstandingTasks = totalTasks - completedTasks;
    const completionPercent =
      totalTasks === 0 ? 100 : Math.round((completedTasks / totalTasks) * 100);

    return {
      speaker,
      confirmed: input.confirmedSpeakerIds.has(speaker.id),
      totalTasks,
      completedTasks,
      outstandingTasks,
      overdueTasks,
      completionPercent,
      views,
    };
  });
}

/**
 * Least-on-track first: any overdue tasks first (most overdue first), then
 * lowest completion %, then alphabetical by name/email — the glanceable
 * order for a table an admin scans for who needs a nudge.
 */
export function sortSpeakerRollups(rollups: SpeakerRollup[]): SpeakerRollup[] {
  return [...rollups].sort((a, b) => {
    if (a.overdueTasks !== b.overdueTasks) return b.overdueTasks - a.overdueTasks;
    if (a.completionPercent !== b.completionPercent) return a.completionPercent - b.completionPercent;
    return (a.speaker.name ?? a.speaker.email).localeCompare(b.speaker.name ?? b.speaker.email);
  });
}

// ---------------------------------------------------------------------------
// Roster membership and filtering (decisions.md D-051)
// ---------------------------------------------------------------------------

export interface RosterSourcesInput {
  /** Speakers on one of this event's sessions — "confirmed" per D-017. */
  confirmedSpeakerIds: Iterable<string>;
  /** Speakers holding an assignment on one of this event's tasks; they belong
   * on the roster before their session is scheduled. */
  assignedSpeakerIds: Iterable<string>;
  /** `event_speakers` rows — added by hand or imported (D-051), which is the
   * only membership a speaker has until they get a session or a task. */
  memberSpeakerIds: Iterable<string>;
}

/**
 * Everyone with a stake in this event, from all three membership sources.
 *
 * Keeping the union here rather than in the page means the record page and
 * the roster agree on who exists — a record page that 404s for someone the
 * roster lists (or the reverse) is the failure mode this prevents.
 */
export function rosterSpeakerIds(input: RosterSourcesInput): Set<string> {
  return new Set<string>([
    ...input.confirmedSpeakerIds,
    ...input.assignedSpeakerIds,
    ...input.memberSpeakerIds,
  ]);
}

/**
 * A speaker's onboarding state in one word, for the roster's filter and badge.
 * `overdue` is a sharper case of `incomplete`, not a separate bucket — see
 * `matchesRosterStatus`.
 */
export type RosterStatus = "complete" | "incomplete" | "overdue";

/** The roster filter's vocabulary; `all` is the unfiltered default. */
export type RosterStatusFilter = "all" | RosterStatus;

export const ROSTER_STATUS_FILTERS: Array<{ value: RosterStatus; label: string }> = [
  { value: "complete", label: "All tasks done" },
  { value: "incomplete", label: "Tasks outstanding" },
  { value: "overdue", label: "Overdue" },
];

export function speakerRosterStatus(rollup: SpeakerRollup): RosterStatus {
  if (rollup.overdueTasks > 0) return "overdue";
  return rollup.outstandingTasks > 0 ? "incomplete" : "complete";
}

/**
 * Filtering on `incomplete` includes overdue speakers: an organizer asking
 * "who still owes me something" means everyone outstanding, and hiding the
 * worst offenders behind a second filter would be a trap.
 */
export function matchesRosterStatus(rollup: SpeakerRollup, filter: string): boolean {
  const status = speakerRosterStatus(rollup);
  switch (filter) {
    case "complete":
      return status === "complete";
    case "incomplete":
      return status !== "complete";
    case "overdue":
      return status === "overdue";
    default:
      return true;
  }
}

/** Name, email, or company — the three things an organizer knows about
 * someone they're hunting for. Case- and whitespace-insensitive. */
export function matchesSpeakerSearch(rollup: SpeakerRollup, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [rollup.speaker.name, rollup.speaker.email, rollup.speaker.company].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

export interface RosterFilter {
  q: string;
  status: string;
}

export function filterSpeakerRollups(
  rollups: SpeakerRollup[],
  filter: RosterFilter,
): SpeakerRollup[] {
  return rollups.filter(
    (rollup) => matchesSpeakerSearch(rollup, filter.q) && matchesRosterStatus(rollup, filter.status),
  );
}
