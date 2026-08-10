import { eq, inArray } from "drizzle-orm";
import { fileCommentSchema, type NewFileComment } from "@/db/entities";
import { fileComments } from "@/db/schema";
import type { FileCommentsRepo } from "@/db/repos/file-comments";
import { inIdChunks } from "./chunk";
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
      // Same D1 100-bound-parameter ceiling as file-versions.ts: an event's
      // full assignment list can outgrow one statement, so this slices
      // rather than issuing one unchunked `IN (...)`.
      const rows = await inIdChunks(assignmentIds, (chunk) =>
        db.query.fileComments.findMany({
          where: inArray(fileComments.assignmentId, chunk),
        }),
      );
      return rows.map((r) => fileCommentSchema.parse(r));
    },
    async create(input: NewFileComment) {
      const [row] = await db.insert(fileComments).values(input).returning();
      return fileCommentSchema.parse(row);
    },
  };
}
