import type { NewTask, Task } from "@/db/entities";

export type TaskDuplicateIdentity = Pick<NewTask, "eventId" | "title" | "type" | "dueAt">;

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

/**
 * Finds the stable duplicate identity called out by the repeated-run audit.
 * Instructions, form source, assignment mode, and auto-assignment are not
 * identity fields: changing those while preserving the event/title/type/due
 * date is more safely handled by editing the existing task. An organizer can
 * explicitly override this check when two copies are intentional.
 */
export function findDuplicateTask(
  existing: Task[],
  candidate: TaskDuplicateIdentity,
): Task | null {
  return (
    existing.find(
      (task) =>
        task.eventId === candidate.eventId &&
        task.title === candidate.title &&
        task.type === candidate.type &&
        sameInstant(task.dueAt, candidate.dueAt),
    ) ?? null
  );
}
