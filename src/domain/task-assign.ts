/**
 * Assigning an existing task to an event's already-confirmed speakers
 * (spec.md §5, decisions.md D-052).
 *
 * Before this, a task reached a speaker's portal only through "auto-assign on
 * acceptance" — run once, at the moment a submission converts. A task created
 * mid-planning, after speakers were already confirmed, never attached to
 * anyone: the task list showed "Assigned: 0" forever and the portal stayed
 * empty. This lets an organizer catch a task up to the event's confirmed
 * roster in one action from the task list.
 *
 * Pure logic only, mirroring src/domain/review.ts's
 * `planAcceptanceConversion`: given the speakers already confirmed for the
 * event and the assignments a task already holds, produce just the
 * (task, speaker) pairs that don't exist yet. Idempotent by construction —
 * an existing row is never read back into the plan, so re-running never
 * duplicates an assignment or resets its completion state.
 */
import type { NewTaskAssignment, TaskAssignment } from "@/db/entities";

export interface AssignToConfirmedSpeakersInput {
  taskId: string;
  /**
   * The event's confirmed speakers (decisions.md D-017, mirrored by the
   * speakers roster page): every userId who appears on any session for the
   * event, however it got there — acceptance conversion or direct entry.
   * Duplicates are tolerated (harmless, deduped here).
   */
  confirmedSpeakerIds: string[];
  /**
   * This task's current assignments. Rows for a different task are ignored
   * rather than assumed absent, so callers may safely pass an event-wide
   * list without pre-filtering.
   */
  existingAssignments: TaskAssignment[];
}

export interface AssignToConfirmedSpeakersPlan {
  /** Only the speakers who don't already hold this task. */
  newAssignments: NewTaskAssignment[];
  /**
   * How many confirmed speakers already held this task before this run —
   * the "everyone already has it" zero-state, and the count that never
   * changes underneath because those rows are never touched.
   */
  alreadyAssignedCount: number;
}

/**
 * Plans the missing (task, speaker) assignments for one task against the
 * event's confirmed roster. Never inspects or reproduces an existing
 * assignment's status/completedAt/etc — an already-held task is skipped
 * outright, so completion state can't be reset by re-running this.
 */
export function planAssignToConfirmedSpeakers(
  input: AssignToConfirmedSpeakersInput,
): AssignToConfirmedSpeakersPlan {
  const held = new Set(
    input.existingAssignments
      .filter((assignment) => assignment.taskId === input.taskId)
      .map((assignment) => assignment.speakerId),
  );

  const uniqueSpeakerIds = [...new Set(input.confirmedSpeakerIds)];

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
