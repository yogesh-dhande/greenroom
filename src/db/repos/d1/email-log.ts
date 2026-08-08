import { eq } from "drizzle-orm";
import { emailLogSchema, type NewEmailLog } from "@/db/entities";
import { emailLog } from "@/db/schema";
import type { EmailLogRepo } from "@/db/repos/email-log";
import type { DrizzleD1 } from "./client";

export function createEmailLogRepo(db: DrizzleD1): EmailLogRepo {
  return {
    async listByUser(userId) {
      const rows = await db.query.emailLog.findMany({
        where: eq(emailLog.userId, userId),
      });
      return rows.map((r) => emailLogSchema.parse(r));
    },
    async listByEvent(eventId) {
      const rows = await db.query.emailLog.findMany({
        where: eq(emailLog.eventId, eventId),
      });
      return rows.map((r) => emailLogSchema.parse(r));
    },
    async create(input: NewEmailLog) {
      const [row] = await db.insert(emailLog).values(input).returning();
      return emailLogSchema.parse(row);
    },
  };
}
