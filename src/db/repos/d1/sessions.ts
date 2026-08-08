import { and, eq, inArray } from "drizzle-orm";
import { sessionSchema, type NewSession, type NewSessionSpeaker } from "@/db/entities";
import { sessionSpeakers, sessions } from "@/db/schema";
import type { SessionsRepo } from "@/db/repos/sessions";
import type { DrizzleD1 } from "./client";

export function createSessionsRepo(db: DrizzleD1): SessionsRepo {
  return {
    async getById(id) {
      const row = await db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      return row ? sessionSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.eventId, eventId),
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listByRoom(roomId) {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.roomId, roomId),
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listByTrack(trackId) {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.trackId, trackId),
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listBySpeaker(userId) {
      const assignments = await db.query.sessionSpeakers.findMany({
        where: eq(sessionSpeakers.userId, userId),
      });
      if (assignments.length === 0) return [];
      const rows = await db.query.sessions.findMany({
        where: inArray(
          sessions.id,
          assignments.map((a) => a.sessionId),
        ),
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async create(input: NewSession) {
      const [row] = await db.insert(sessions).values(input).returning();
      return sessionSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(sessions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(sessions.id, id))
        .returning();
      return sessionSchema.parse(row);
    },
    async delete(id) {
      await db.delete(sessions).where(eq(sessions.id, id));
    },
    async listSpeakers(sessionId) {
      const rows = await db.query.sessionSpeakers.findMany({
        where: eq(sessionSpeakers.sessionId, sessionId),
      });
      return rows.map((r) => r.userId);
    },
    async assignSpeaker(input: NewSessionSpeaker) {
      await db.insert(sessionSpeakers).values(input).onConflictDoNothing();
    },
    async unassignSpeaker(sessionId, userId) {
      await db
        .delete(sessionSpeakers)
        .where(
          and(eq(sessionSpeakers.sessionId, sessionId), eq(sessionSpeakers.userId, userId)),
        );
    },
  };
}
