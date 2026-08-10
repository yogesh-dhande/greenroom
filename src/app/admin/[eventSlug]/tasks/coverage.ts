/**
 * How far a task has got through the confirmed roster — what "Assign to
 * confirmed speakers" (decisions.md D-052) would actually add if pressed.
 *
 * Pure, so the task list's button state and its confirmation copy can't drift
 * apart from what the action will do.
 */
import type { TaskSpeakerOption } from "./types";

/**
 * The confirmed speakers who don't hold this task yet.
 *
 * A set difference, not "confirmed count − assignment count": assignments are
 * not all held by confirmed speakers — a task handed individually to an
 * invited keynote before any session exists, or held by someone since marked
 * Declined (D-068, D-069), is a real row that covers nobody on the confirmed
 * roster. Subtracting counts let those rows pass as coverage, which disabled
 * the button while confirmed speakers still lacked the task.
 */
export function unassignedConfirmedSpeakerIds(
  speakers: readonly TaskSpeakerOption[],
  assignedSpeakerIds: readonly string[],
): string[] {
  const assigned = new Set(assignedSpeakerIds);
  return speakers
    .filter((speaker) => speaker.confirmed && !assigned.has(speaker.id))
    .map((speaker) => speaker.id);
}
