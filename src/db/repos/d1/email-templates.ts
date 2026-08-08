import { and, eq } from "drizzle-orm";
import { emailTemplateSchema, type NewEmailTemplate } from "@/db/entities";
import { emailTemplates } from "@/db/schema";
import type { EmailTemplatesRepo } from "@/db/repos/email-templates";
import type { DrizzleD1 } from "./client";

export function createEmailTemplatesRepo(db: DrizzleD1): EmailTemplatesRepo {
  return {
    async getById(id) {
      const row = await db.query.emailTemplates.findFirst({
        where: eq(emailTemplates.id, id),
      });
      return row ? emailTemplateSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.emailTemplates.findMany({
        where: eq(emailTemplates.eventId, eventId),
      });
      return rows.map((r) => emailTemplateSchema.parse(r));
    },
    async listByTrigger(eventId, trigger) {
      const rows = await db.query.emailTemplates.findMany({
        where: and(
          eq(emailTemplates.eventId, eventId),
          eq(emailTemplates.trigger, trigger),
        ),
      });
      return rows.map((r) => emailTemplateSchema.parse(r));
    },
    async create(input: NewEmailTemplate) {
      const [row] = await db.insert(emailTemplates).values(input).returning();
      return emailTemplateSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(emailTemplates)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(emailTemplates.id, id))
        .returning();
      return emailTemplateSchema.parse(row);
    },
    async delete(id) {
      await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
    },
  };
}
