import { eq, inArray } from "drizzle-orm";
import { fileVersionSchema, type NewFileVersion } from "@/db/entities";
import { fileVersions } from "@/db/schema";
import type { FileVersionsRepo } from "@/db/repos/file-versions";
import type { DrizzleD1 } from "./client";

export function createFileVersionsRepo(db: DrizzleD1): FileVersionsRepo {
  return {
    async listByAssignment(assignmentId) {
      const rows = await db.query.fileVersions.findMany({
        where: eq(fileVersions.assignmentId, assignmentId),
      });
      return rows.map((r) => fileVersionSchema.parse(r));
    },
    async listByAssignments(assignmentIds) {
      if (assignmentIds.length === 0) return [];
      const rows = await db.query.fileVersions.findMany({
        where: inArray(fileVersions.assignmentId, assignmentIds),
      });
      return rows.map((r) => fileVersionSchema.parse(r));
    },
    async create(input: NewFileVersion) {
      const [row] = await db.insert(fileVersions).values(input).returning();
      return fileVersionSchema.parse(row);
    },
  };
}
