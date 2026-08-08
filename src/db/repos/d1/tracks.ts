import { eq } from "drizzle-orm";
import { trackSchema, type NewTrack } from "@/db/entities";
import { tracks } from "@/db/schema";
import type { TracksRepo } from "@/db/repos/tracks";
import type { DrizzleD1 } from "./client";

export function createTracksRepo(db: DrizzleD1): TracksRepo {
  return {
    async getById(id) {
      const row = await db.query.tracks.findFirst({ where: eq(tracks.id, id) });
      return row ? trackSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.tracks.findMany({
        where: eq(tracks.eventId, eventId),
      });
      return rows.map((r) => trackSchema.parse(r));
    },
    async create(input: NewTrack) {
      const [row] = await db.insert(tracks).values(input).returning();
      return trackSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(tracks)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tracks.id, id))
        .returning();
      return trackSchema.parse(row);
    },
    async delete(id) {
      await db.delete(tracks).where(eq(tracks.id, id));
    },
  };
}
