import { and, desc, eq } from "drizzle-orm";
import { emailLogSchema, type NewEmailLog } from "@/db/entities";
import { emailLog } from "@/db/schema";
import type { EmailLogRepo } from "@/db/repos/email-log";
import type { DrizzleD1 } from "./client";

export function createEmailLogRepo(db: DrizzleD1): EmailLogRepo {
  return {
    async listByRecipient(email) {
      const rows = await db.query.emailLog.findMany({
        where: eq(emailLog.to, email),
        orderBy: [desc(emailLog.sentAt)],
      });
      return rows.map((r) => emailLogSchema.parse(r));
    },
    async listByRelated(relatedType, relatedId) {
      const rows = await db.query.emailLog.findMany({
        where: and(eq(emailLog.relatedType, relatedType), eq(emailLog.relatedId, relatedId)),
        orderBy: [desc(emailLog.sentAt)],
      });
      return rows.map((r) => emailLogSchema.parse(r));
    },
    async listRecent(limit) {
      const rows = await db.query.emailLog.findMany({
        orderBy: [desc(emailLog.sentAt)],
        limit,
      });
      return rows.map((r) => emailLogSchema.parse(r));
    },
    async create(input: NewEmailLog) {
      const [row] = await db.insert(emailLog).values(input).returning();
      return emailLogSchema.parse(row);
    },
  };
}
