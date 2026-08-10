import { and, asc, eq, inArray } from "drizzle-orm";
import { formSchema, type NewForm } from "@/db/entities";
import { forms } from "@/db/schema";
import type { FormsRepo } from "@/db/repos/forms";
import { inIdChunks } from "./chunk";
import type { DrizzleD1 } from "./client";

export function createFormsRepo(db: DrizzleD1): FormsRepo {
  return {
    async getById(id) {
      const row = await db.query.forms.findFirst({ where: eq(forms.id, id) });
      return row ? formSchema.parse(row) : null;
    },
    async getBySlug(slug) {
      const row = await db.query.forms.findFirst({ where: eq(forms.slug, slug) });
      return row ? formSchema.parse(row) : null;
    },
    async listByIds(ids) {
      const rows = await inIdChunks(ids, (chunk) =>
        db.query.forms.findMany({ where: inArray(forms.id, chunk) }),
      );
      return rows.map((r) => formSchema.parse(r));
    },
    async listByEvent(eventId) {
      const rows = await db.query.forms.findMany({
        where: eq(forms.eventId, eventId),
        orderBy: [asc(forms.name)],
      });
      return rows.map((r) => formSchema.parse(r));
    },
    async listPublishedByEvent(eventId) {
      const rows = await db.query.forms.findMany({
        where: and(eq(forms.eventId, eventId), eq(forms.isPublished, true)),
        orderBy: [asc(forms.name)],
      });
      return rows.map((r) => formSchema.parse(r));
    },
    async create(input: NewForm) {
      const [row] = await db.insert(forms).values(input).returning();
      return formSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(forms)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(forms.id, id))
        .returning();
      return formSchema.parse(row);
    },
    async delete(id) {
      await db.delete(forms).where(eq(forms.id, id));
    },
  };
}
