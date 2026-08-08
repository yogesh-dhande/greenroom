import { and, eq, inArray, lte } from "drizzle-orm";
import { taskAssignmentSchema, type NewTaskAssignment } from "@/db/entities";
import { taskAssignments, tasks } from "@/db/schema";
import type { TaskAssignmentsRepo } from "@/db/repos/task-assignments";
import type { DrizzleD1 } from "./client";

export function createTaskAssignmentsRepo(db: DrizzleD1): TaskAssignmentsRepo {
  /** Assignments belong to a task, and only tasks carry the event — so every
   * event-scoped query resolves the event's task ids first. */
  async function taskIdsForEvent(eventId: string, dueBefore?: Date): Promise<string[]> {
    const rows = await db.query.tasks.findMany({
      where: dueBefore
        ? and(eq(tasks.eventId, eventId), lte(tasks.dueAt, dueBefore))
        : eq(tasks.eventId, eventId),
      columns: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async function byTaskIds(taskIds: string[], pendingOnly: boolean) {
    if (taskIds.length === 0) return [];
    const rows = await db.query.taskAssignments.findMany({
      where: pendingOnly
        ? and(inArray(taskAssignments.taskId, taskIds), eq(taskAssignments.status, "pending"))
        : inArray(taskAssignments.taskId, taskIds),
    });
    return rows.map((r) => taskAssignmentSchema.parse(r));
  }

  return {
    async getById(id) {
      const row = await db.query.taskAssignments.findFirst({
        where: eq(taskAssignments.id, id),
      });
      return row ? taskAssignmentSchema.parse(row) : null;
    },
    async listByTask(taskId) {
      const rows = await db.query.taskAssignments.findMany({
        where: eq(taskAssignments.taskId, taskId),
      });
      return rows.map((r) => taskAssignmentSchema.parse(r));
    },
    async listBySpeaker(speakerId) {
      const rows = await db.query.taskAssignments.findMany({
        where: eq(taskAssignments.speakerId, speakerId),
      });
      return rows.map((r) => taskAssignmentSchema.parse(r));
    },
    async listByEvent(eventId) {
      return byTaskIds(await taskIdsForEvent(eventId), false);
    },
    async listPendingByEvent(eventId) {
      return byTaskIds(await taskIdsForEvent(eventId), true);
    },
    async listPendingDueBefore(eventId, before) {
      return byTaskIds(await taskIdsForEvent(eventId, before), true);
    },
    async getByTaskAndSpeaker(taskId, speakerId) {
      const row = await db.query.taskAssignments.findFirst({
        where: and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.speakerId, speakerId)),
      });
      return row ? taskAssignmentSchema.parse(row) : null;
    },
    async create(input: NewTaskAssignment) {
      const [row] = await db.insert(taskAssignments).values(input).returning();
      return taskAssignmentSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(taskAssignments)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(taskAssignments.id, id))
        .returning();
      return taskAssignmentSchema.parse(row);
    },
    async delete(id) {
      await db.delete(taskAssignments).where(eq(taskAssignments.id, id));
    },
  };
}
