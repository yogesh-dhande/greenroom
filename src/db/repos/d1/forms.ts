import { and, eq } from "drizzle-orm";
import { formSchema, type NewForm } from "@/db/entities";
import { forms } from "@/db/schema";
import type { FormsRepo } from "@/db/repos/forms";
import type { DrizzleD1 } from "./client";

export function createFormsRepo(db: DrizzleD1): FormsRepo {
  return {
    async getById(id) {
      const row = await db.query.forms.findFirst({ where: eq(forms.id, id) });
      return row ? formSchema.parse(row) : null;
    },
    async getBySlug(eventId, slug) {
      const row = await db.query.forms.findFirst({
        where: and(eq(forms.eventId, eventId), eq(forms.slug, slug)),
      });
      return row ? formSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.forms.findMany({
        where: eq(forms.eventId, eventId),
      });
      return rows.map((r) => formSchema.parse(r));
    },
    async listByStatus(eventId, status) {
      const rows = await db.query.forms.findMany({
        where: and(eq(forms.eventId, eventId), eq(forms.status, status)),
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
