import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { taskAssignmentSchema, type NewTaskAssignment } from "@/db/entities";
import { taskAssignments, tasks } from "@/db/schema";
import type { TaskAssignmentsRepo } from "@/db/repos/task-assignments";
import type { DrizzleD1 } from "./client";

export function createTaskAssignmentsRepo(db: DrizzleD1): TaskAssignmentsRepo {
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
    async listByUser(userId) {
      const rows = await db.query.taskAssignments.findMany({
        where: eq(taskAssignments.userId, userId),
      });
      return rows.map((r) => taskAssignmentSchema.parse(r));
    },
    async listIncompleteByEvent(eventId) {
      const eventTasks = await db.query.tasks.findMany({
        where: eq(tasks.eventId, eventId),
        columns: { id: true },
      });
      if (eventTasks.length === 0) return [];
      const rows = await db.query.taskAssignments.findMany({
        where: and(
          inArray(
            taskAssignments.taskId,
            eventTasks.map((t) => t.id),
          ),
          ne(taskAssignments.status, "complete"),
        ),
      });
      return rows.map((r) => taskAssignmentSchema.parse(r));
    },
    async listIncompleteDueBefore(eventId, before) {
      const eventTasks = await db.query.tasks.findMany({
        where: and(eq(tasks.eventId, eventId), lte(tasks.dueDate, before)),
        columns: { id: true },
      });
      if (eventTasks.length === 0) return [];
      const rows = await db.query.taskAssignments.findMany({
        where: and(
          inArray(
            taskAssignments.taskId,
            eventTasks.map((t) => t.id),
          ),
          ne(taskAssignments.status, "complete"),
        ),
      });
      return rows.map((r) => taskAssignmentSchema.parse(r));
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
