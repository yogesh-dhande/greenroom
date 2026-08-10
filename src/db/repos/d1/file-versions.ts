import { and, eq, inArray } from "drizzle-orm";
import { fileVersionSchema, type NewFileVersion } from "@/db/entities";
import { fileVersions } from "@/db/schema";
import type { FileVersionsRepo } from "@/db/repos/file-versions";
import { inIdChunks } from "./chunk";
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
    async listProfileVersionsByOwners(ownerUserIds) {
      // A whole roster's worth of ids, so this is the one read here that can
      // outgrow D1's bound-parameter ceiling.
      const rows = await inIdChunks(ownerUserIds, (chunk) =>
        db.query.fileVersions.findMany({
          where: and(eq(fileVersions.scope, "profile"), inArray(fileVersions.ownerUserId, chunk)),
        }),
      );
      return rows.map((r) => fileVersionSchema.parse(r));
    },
    async create(input: NewFileVersion) {
      // The optional owner columns are spelled out rather than left undefined
      // so an assignment upload always lands as `('assignment', id, null)`.
      const [row] = await db
        .insert(fileVersions)
        .values({
          ...input,
          scope: input.scope ?? "assignment",
          assignmentId: input.assignmentId ?? null,
          ownerUserId: input.ownerUserId ?? null,
        })
        .returning();
      return fileVersionSchema.parse(row);
    },
  };
}
