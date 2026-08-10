import { asc, eq, inArray } from "drizzle-orm";
import { eventSchema, type Event, type NewEvent } from "@/db/entities";
import { events } from "@/db/schema";
import type { EventsRepo } from "@/db/repos/events";
import { inIdChunks } from "./chunk";
import type { DrizzleD1 } from "./client";

/**
 * `listByIds` promises `listAll`'s ordering, but a long id list is answered by
 * several statements, each sorted only within itself. Re-sorting the merged
 * rows here restores the single ordering — SQLite sorts NULLs first, so an
 * event with no start date leads, exactly as it does under `ORDER BY`.
 */
function byStartDate(a: Event, b: Event): number {
  if (a.startDate === b.startDate) return 0;
  if (a.startDate === null) return -1;
  if (b.startDate === null) return 1;
  return a.startDate < b.startDate ? -1 : 1;
}

export function createEventsRepo(db: DrizzleD1): EventsRepo {
  return {
    async getById(id) {
      const row = await db.query.events.findFirst({ where: eq(events.id, id) });
      return row ? eventSchema.parse(row) : null;
    },
    async listByIds(ids) {
      const rows = await inIdChunks(ids, (chunk) =>
        db.query.events.findMany({
          where: inArray(events.id, chunk),
          orderBy: [asc(events.startDate)],
        }),
      );
      return rows.map((r) => eventSchema.parse(r)).sort(byStartDate);
    },
    async getBySlug(slug) {
      const row = await db.query.events.findFirst({ where: eq(events.slug, slug) });
      return row ? eventSchema.parse(row) : null;
    },
    async listAll() {
      const rows = await db.query.events.findMany({ orderBy: [asc(events.startDate)] });
      return rows.map((r) => eventSchema.parse(r));
    },
    async create(input: NewEvent) {
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
