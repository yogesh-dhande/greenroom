import { asc, eq } from "drizzle-orm";
import { segmentSchema, type NewSegment } from "@/db/entities";
import { segments } from "@/db/schema";
import type { SegmentsRepo } from "@/db/repos/segments";
import type { DrizzleD1 } from "./client";

/**
 * D1/Drizzle implementation of saved directory segments (decisions.md D-077).
 * `query` is stored and returned verbatim — the filter's shape is the domain's
 * business (src/domain/segments.ts), not the storage layer's.
 */
export function createSegmentsRepo(db: DrizzleD1): SegmentsRepo {
  return {
    async getById(id) {
      const row = await db.query.segments.findFirst({ where: eq(segments.id, id) });
      return row ? segmentSchema.parse(row) : null;
    },
    async listAll() {
      const rows = await db.query.segments.findMany({ orderBy: [asc(segments.name)] });
      return rows.map((row) => segmentSchema.parse(row));
    },
    async create(input: NewSegment) {
      const [row] = await db.insert(segments).values(input).returning();
      return segmentSchema.parse(row);
    },
    async delete(id) {
      await db.delete(segments).where(eq(segments.id, id));
    },
  };
}
