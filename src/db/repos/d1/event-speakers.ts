import { and, asc, eq } from "drizzle-orm";
import { eventSpeakerSchema } from "@/db/entities";
import { eventSpeakers } from "@/db/schema";
import type { EventSpeakersRepo } from "@/db/repos/event-speakers";
import type { DrizzleD1 } from "./client";

export function createEventSpeakersRepo(db: DrizzleD1): EventSpeakersRepo {
  return {
    async get(eventId, userId) {
      const row = await db.query.eventSpeakers.findFirst({
        where: and(eq(eventSpeakers.eventId, eventId), eq(eventSpeakers.userId, userId)),
      });
      return row ? eventSpeakerSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.eventSpeakers.findMany({
        where: eq(eventSpeakers.eventId, eventId),
        orderBy: [asc(eventSpeakers.createdAt)],
      });
      return rows.map((r) => eventSpeakerSchema.parse(r));
    },
    async add(eventId, userId) {
      // `onConflictDoNothing` returns nothing when the row already exists, so
      // the existing record is read back rather than assumed — the caller
      // wants the notes that are already there, not an empty one.
      const [inserted] = await db
        .insert(eventSpeakers)
        .values({ eventId, userId })
        .onConflictDoNothing()
        .returning();
      if (inserted) return eventSpeakerSchema.parse(inserted);

      const existing = await db.query.eventSpeakers.findFirst({
        where: and(eq(eventSpeakers.eventId, eventId), eq(eventSpeakers.userId, userId)),
      });
      return eventSpeakerSchema.parse(existing);
    },
    async setNotes(eventId, userId, notes) {
      const [row] = await db
        .insert(eventSpeakers)
        .values({ eventId, userId, notes })
        .onConflictDoUpdate({
          target: [eventSpeakers.eventId, eventSpeakers.userId],
          set: { notes, updatedAt: new Date() },
        })
        .returning();
      return eventSpeakerSchema.parse(row);
    },
  };
}
