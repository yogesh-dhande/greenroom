import { eq } from "drizzle-orm";
import { eventSchema, type Event, type NewEvent } from "@/db/entities";
import { events } from "@/db/schema";
import type { EventsRepo } from "@/db/repos/events";
import type { DrizzleD1 } from "./client";

export function createEventsRepo(db: DrizzleD1): EventsRepo {
  return {
    async getById(id) {
      const row = await db.query.events.findFirst({ where: eq(events.id, id) });
      return row ? eventSchema.parse(row) : null;
    },
    async getBySlug(slug) {
      const row = await db.query.events.findFirst({
        where: eq(events.slug, slug),
      });
      return row ? eventSchema.parse(row) : null;
    },
    async listAll() {
      const rows = await db.query.events.findMany();
      return rows.map((r) => eventSchema.parse(r));
    },
    async create(input: NewEvent): Promise<Event> {
      const [row] = await db.insert(events).values(input).returning();
      return eventSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(events)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(events.id, id))
        .returning();
      return eventSchema.parse(row);
    },
    async delete(id) {
      await db.delete(events).where(eq(events.id, id));
    },
  };
}
