import { eq } from "drizzle-orm";
import { roomSchema, type NewRoom } from "@/db/entities";
import { rooms } from "@/db/schema";
import type { RoomsRepo } from "@/db/repos/rooms";
import type { DrizzleD1 } from "./client";

export function createRoomsRepo(db: DrizzleD1): RoomsRepo {
  return {
    async getById(id) {
      const row = await db.query.rooms.findFirst({ where: eq(rooms.id, id) });
      return row ? roomSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.rooms.findMany({
        where: eq(rooms.eventId, eventId),
      });
      return rows.map((r) => roomSchema.parse(r));
    },
    async create(input: NewRoom) {
      const [row] = await db.insert(rooms).values(input).returning();
      return roomSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(rooms)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(rooms.id, id))
        .returning();
      return roomSchema.parse(row);
    },
    async delete(id) {
      await db.delete(rooms).where(eq(rooms.id, id));
    },
  };
}
