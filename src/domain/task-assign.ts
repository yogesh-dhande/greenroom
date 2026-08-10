/**
 * Assigning an existing task to an event's speakers — all of the confirmed
 * ones at once, or a chosen few (spec.md §5, decisions.md D-052, D-069).
 *
 * Before this, a task reached a speaker's portal only through "auto-assign on
 * acceptance" — run once, at the moment a submission converts. A task created
 * mid-planning, after speakers were already confirmed, never attached to
 * anyone: the task list showed "Assigned: 0" forever and the portal stayed
 * empty. This lets an organizer catch a task up to the event's confirmed
 * roster in one action from the task list, hand one task to one speaker from
 * their record page, or aim a task at a chosen subset as they create it
 * (D-069).
 *
 * Pure logic only, mirroring src/domain/review.ts's
 * `planAcceptanceConversion`: given the speakers to assign and the
 * assignments a task already holds, produce just the (task, speaker) pairs
 * that don't exist yet. Idempotent by construction — an existing row is
 * never read back into the plan, so re-running never duplicates an
 * assignment or resets its completion state. Every assignment path in the
 * app funnels through `planAssignToSpeakers`, so none of them can grow its
 * own weaker version of that rule.
 */
import type { NewTaskAssignment, TaskAssignment } from "@/db/entities";

export interface AssignToSpeakersInput {
  taskId: string;
  /**
   * Who should end up holding the task: the event's confirmed speakers, a
   * subset an organizer picked, or a single speaker from their record page.
   * Duplicates are tolerated (harmless, deduped here).
   */
  speakerIds: string[];
  /**
   * This task's current assignments. Rows for a different task are ignored
   * rather than assumed absent, so callers may safely pass an event-wide
   * list without pre-filtering.
   */
  existingAssignments: TaskAssignment[];
}

export interface AssignmentPlan {
  /** Only the speakers who don't already hold this task. */
  newAssignments: NewTaskAssignment[];
  /**
   * How many of the requested speakers already held this task before this
   * run — the "everyone already has it" zero-state, and the count that never
   * changes underneath because those rows are never touched.
   */
  alreadyAssignedCount: number;
}

/**
 * Plans the missing (task, speaker) assignments for one task against an
 * arbitrary list of speakers. Never inspects or reproduces an existing
 * assignment's status/completedAt/etc — an already-held task is skipped
 * outright, so completion state can't be reset by re-running this.
 *
 * This is the one place assignment rows are shaped, whichever surface asked
 * for them: the task list's "assign to confirmed speakers", the task
 * dialog's chosen subset, and the speaker record page's single assignment
 * (D-069) all end up here, so all three inherit the same dedupe rather than
 * each re-deciding what "already assigned" means.
 */
export function planAssignToSpeakers(input: AssignToSpeakersInput): AssignmentPlan {
  const held = new Set(
    input.existingAssignments
      .filter((assignment) => assignment.taskId === input.taskId)
      .map((assignment) => assignment.speakerId),
  );

  const uniqueSpeakerIds = [...new Set(input.speakerIds)];

  const newAssignments: NewTaskAssignment[] = [];
  let alreadyAssignedCount = 0;
  for (const speakerId of uniqueSpeakerIds) {
    if (held.has(speakerId)) {
      alreadyAssignedCount += 1;
      continue;
    }
    newAssignments.push({
      taskId: input.taskId,
      speakerId,
      status: "pending",
      completedAt: null,
      responseJson: null,
      fileUrl: null,
    });
  }

  return { newAssignments, alreadyAssignedCount };
}

export interface AssignToConfirmedSpeakersInput {
  taskId: string;
  /**
   * The event's confirmed speakers (decisions.md D-017, mirrored by the
   * speakers roster page): every userId who appears on any session for the
   * event, however it got there — acceptance conversion or direct entry.
   */
  confirmedSpeakerIds: string[];
  existingAssignments: TaskAssignment[];
}

/** @deprecated shape alias kept so existing callers read unchanged. */
export type AssignToConfirmedSpeakersPlan = AssignmentPlan;

/**
 * The "catch this task up to everyone confirmed" case (D-052) — named for
 * the action it backs, but no different in kind from any other assignment,
 * so it's a thin call into `planAssignToSpeakers`.
 */
export function planAssignToConfirmedSpeakers(
  input: AssignToConfirmedSpeakersInput,
): AssignmentPlan {
  return planAssignToSpeakers({
    taskId: input.taskId,
    speakerIds: input.confirmedSpeakerIds,
    existingAssignments: input.existingAssignments,
  });
}

// ---------------------------------------------------------------------------
// Who a task is aimed at (decisions.md D-069)
// ---------------------------------------------------------------------------

/**
 * How the task dialog's "who gets this task" control was left.
 *
 * `all_confirmed` is the default and means exactly what it always meant:
 * every speaker gets the task as their talk is accepted (`autoAssignOnAccept`)
 * and the task list's one-click action catches up anyone already confirmed.
 * Saving the task assigns nobody on its own — that's today's behavior, kept.
 * `selected` is the new targeted case: the chosen speakers are assigned the
 * moment the task is saved.
 */
export const TASK_ASSIGNEE_MODES = ["all_confirmed", "selected"] as const;
export type TaskAssigneeMode = (typeof TASK_ASSIGNEE_MODES)[number];

export interface AssigneeSelectionInput {
  mode: TaskAssigneeMode;
  /** Speaker ids the organizer ticked; ignored unless `mode` is "selected". */
  selectedSpeakerIds: string[];
  /**
   * Everyone on this event's roster — the only ids a selection may name. A
   * speaker id is just a user id, so an unfiltered selection posted straight
   * from the browser would let an admin attach any account on the instance
   * to their event's task (the same hazard `loadRosterSpeaker` closes for
   * profile edits in src/app/admin/[eventSlug]/speakers/actions.ts).
   */
  rosterSpeakerIds: string[];
}

/**
 * The speakers a save should assign, in roster order and without duplicates.
 *
 * `all_confirmed` resolves to nothing on purpose: that mode leaves
 * assignment to acceptance and the task list's explicit action, so saving a
 * task must not quietly fan it out to the whole roster.
 */
export function resolveAssigneeSpeakerIds(input: AssigneeSelectionInput): string[] {
  if (input.mode !== "selected") return [];
  const selected = new Set(input.selectedSpeakerIds);
  return [...new Set(input.rosterSpeakerIds)].filter((id) => selected.has(id));
}
