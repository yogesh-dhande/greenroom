import { and, asc, eq, inArray } from "drizzle-orm";
import { trackSchema, type NewTrack } from "@/db/entities";
import { reviewerTracks, tracks } from "@/db/schema";
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
        orderBy: [asc(tracks.name)],
      });
      return rows.map((r) => trackSchema.parse(r));
    },
    async listByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.query.tracks.findMany({ where: inArray(tracks.id, ids) });
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

    async listByReviewer(userId) {
      const links = await db.query.reviewerTracks.findMany({
        where: eq(reviewerTracks.userId, userId),
      });
      if (links.length === 0) return [];
      const rows = await db.query.tracks.findMany({
        where: inArray(
          tracks.id,
          links.map((l) => l.trackId),
        ),
        orderBy: [asc(tracks.name)],
      });
      return rows.map((r) => trackSchema.parse(r));
    },
    async listReviewerIds(trackId) {
      const links = await db.query.reviewerTracks.findMany({
        where: eq(reviewerTracks.trackId, trackId),
      });
      return links.map((l) => l.userId);
    },
    async assignReviewer(userId, trackId) {
      await db.insert(reviewerTracks).values({ userId, trackId }).onConflictDoNothing();
    },
    async unassignReviewer(userId, trackId) {
      await db
        .delete(reviewerTracks)
        .where(and(eq(reviewerTracks.userId, userId), eq(reviewerTracks.trackId, trackId)));
    },
    async setReviewerTracks(userId, trackIds) {
      await db.delete(reviewerTracks).where(eq(reviewerTracks.userId, userId));
      if (trackIds.length === 0) return;
      await db
        .insert(reviewerTracks)
        .values(trackIds.map((trackId) => ({ userId, trackId })))
        .onConflictDoNothing();
    },
  };
}
