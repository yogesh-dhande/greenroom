import { desc, eq, inArray } from "drizzle-orm";
import { sessionRevisionSchema, type NewSessionRevision } from "@/db/entities";
import { sessionRevisions } from "@/db/schema";
import type { SessionRevisionsRepo } from "@/db/repos/session-revisions";
import type { DrizzleD1 } from "./client";

export function createSessionRevisionsRepo(db: DrizzleD1): SessionRevisionsRepo {
  /** Newest first; the id breaks ties between two edits in the same second. */
  const newestFirst = [desc(sessionRevisions.createdAt), desc(sessionRevisions.id)];

  return {
    async getById(id) {
      const row = await db.query.sessionRevisions.findFirst({
        where: eq(sessionRevisions.id, id),
      });
      return row ? sessionRevisionSchema.parse(row) : null;
    },
    async listBySession(sessionId) {
      const rows = await db.query.sessionRevisions.findMany({
        where: eq(sessionRevisions.sessionId, sessionId),
        orderBy: newestFirst,
      });
      return rows.map((r) => sessionRevisionSchema.parse(r));
    },
    async listBySessions(sessionIds) {
      if (sessionIds.length === 0) return [];
      const rows = await db.query.sessionRevisions.findMany({
        where: inArray(sessionRevisions.sessionId, sessionIds),
        orderBy: newestFirst,
      });
      return rows.map((r) => sessionRevisionSchema.parse(r));
    },
    async create(input: NewSessionRevision) {
      const [row] = await db.insert(sessionRevisions).values(input).returning();
      return sessionRevisionSchema.parse(row);
    },
  };
}
