import { and, asc, eq, inArray } from "drizzle-orm";
import { taskSchema, type NewTask } from "@/db/entities";
import { tasks } from "@/db/schema";
import type { TasksRepo } from "@/db/repos/tasks";
import type { DrizzleD1 } from "./client";

export function createTasksRepo(db: DrizzleD1): TasksRepo {
  return {
    async getById(id) {
      const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
      return row ? taskSchema.parse(row) : null;
    },
    async listByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.query.tasks.findMany({ where: inArray(tasks.id, ids) });
      return rows.map((r) => taskSchema.parse(r));
    },
    async listByEvent(eventId) {
      const rows = await db.query.tasks.findMany({
        where: eq(tasks.eventId, eventId),
        orderBy: [asc(tasks.dueAt), asc(tasks.title)],
      });
      return rows.map((r) => taskSchema.parse(r));
    },
    async listAutoAssignByEvent(eventId) {
      const rows = await db.query.tasks.findMany({
        where: and(eq(tasks.eventId, eventId), eq(tasks.autoAssignOnAccept, true)),
        orderBy: [asc(tasks.dueAt), asc(tasks.title)],
      });
      return rows.map((r) => taskSchema.parse(r));
    },
    async create(input: NewTask) {
      const [row] = await db.insert(tasks).values(input).returning();
      return taskSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(tasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning();
      return taskSchema.parse(row);
    },
    async delete(id) {
      await db.delete(tasks).where(eq(tasks.id, id));
    },
  };
}
