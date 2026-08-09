import { eq, inArray } from "drizzle-orm";
import { fileCommentSchema, type NewFileComment } from "@/db/entities";
import { fileComments } from "@/db/schema";
import type { FileCommentsRepo } from "@/db/repos/file-comments";
import type { DrizzleD1 } from "./client";

export function createFileCommentsRepo(db: DrizzleD1): FileCommentsRepo {
  return {
    async listByAssignment(assignmentId) {
      const rows = await db.query.fileComments.findMany({
        where: eq(fileComments.assignmentId, assignmentId),
      });
      return rows.map((r) => fileCommentSchema.parse(r));
    },
    async listByAssignments(assignmentIds) {
      if (assignmentIds.length === 0) return [];
      const rows = await db.query.fileComments.findMany({
        where: inArray(fileComments.assignmentId, assignmentIds),
      });
      return rows.map((r) => fileCommentSchema.parse(r));
    },
    async create(input: NewFileComment) {
      const [row] = await db.insert(fileComments).values(input).returning();
      return fileCommentSchema.parse(row);
    },
  };
}
