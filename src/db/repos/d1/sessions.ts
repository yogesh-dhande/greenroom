import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { sessionSchema, sessionSpeakerSchema, type NewSession } from "@/db/entities";
import { sessionSpeakers, sessions } from "@/db/schema";
import type { SessionsRepo } from "@/db/repos/sessions";
import type { DrizzleD1 } from "./client";

export function createSessionsRepo(db: DrizzleD1): SessionsRepo {
  /** Agenda order: day, then start time, then title. Nulls sort last in
   * SQLite's ASC ordering, so unscheduled rows naturally trail. */
  const agendaOrder = [asc(sessions.day), asc(sessions.startTime), asc(sessions.title)];

  return {
    async getById(id) {
      const row = await db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      return row ? sessionSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.eventId, eventId),
        orderBy: agendaOrder,
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listByDay(eventId, day) {
      const rows = await db.query.sessions.findMany({
        where: and(eq(sessions.eventId, eventId), eq(sessions.day, day)),
        orderBy: agendaOrder,
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listUnscheduled(eventId) {
      const rows = await db.query.sessions.findMany({
        where: and(
          eq(sessions.eventId, eventId),
          or(isNull(sessions.day), isNull(sessions.startTime)),
        ),
        orderBy: [asc(sessions.title)],
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listByRoom(roomId) {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.roomId, roomId),
        orderBy: agendaOrder,
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listByTrack(trackId) {
      const rows = await db.query.sessions.findMany({
        where: eq(sessions.trackId, trackId),
        orderBy: agendaOrder,
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async listBySpeaker(userId) {
      const links = await db.query.sessionSpeakers.findMany({
        where: eq(sessionSpeakers.userId, userId),
      });
      if (links.length === 0) return [];
      const rows = await db.query.sessions.findMany({
        where: inArray(
          sessions.id,
          links.map((l) => l.sessionId),
        ),
        orderBy: agendaOrder,
      });
      return rows.map((r) => sessionSchema.parse(r));
    },
    async getBySubmission(submissionId) {
      const row = await db.query.sessions.findFirst({
        where: eq(sessions.submissionId, submissionId),
      });
      return row ? sessionSchema.parse(row) : null;
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

    async listSpeakerIds(sessionId) {
      const links = await db.query.sessionSpeakers.findMany({
        where: eq(sessionSpeakers.sessionId, sessionId),
      });
      return links.map((l) => l.userId);
    },
    async listSpeakersBySessionIds(sessionIds) {
      if (sessionIds.length === 0) return [];
      const links = await db.query.sessionSpeakers.findMany({
        where: inArray(sessionSpeakers.sessionId, sessionIds),
      });
      return links.map((l) => sessionSpeakerSchema.parse(l));
    },
    async assignSpeaker(sessionId, userId) {
      await db.insert(sessionSpeakers).values({ sessionId, userId }).onConflictDoNothing();
    },
    async unassignSpeaker(sessionId, userId) {
      await db
        .delete(sessionSpeakers)
        .where(and(eq(sessionSpeakers.sessionId, sessionId), eq(sessionSpeakers.userId, userId)));
    },
  };
}
