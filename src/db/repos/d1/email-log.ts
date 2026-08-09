import { and, count, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { emailLogSchema, type NewEmailLog } from "@/db/entities";
import { emailLog } from "@/db/schema";
import type { EmailLogFilter, EmailLogRepo } from "@/db/repos/email-log";
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
    async listByRecipients(emails) {
      if (emails.length === 0) return [];
      const rows = await db.query.emailLog.findMany({
        where: inArray(emailLog.to, emails),
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
    async listByRelatedIds(relatedType, relatedIds) {
      if (relatedIds.length === 0) return [];
      const rows = await db.query.emailLog.findMany({
        where: and(
          eq(emailLog.relatedType, relatedType),
          inArray(emailLog.relatedId, relatedIds),
        ),
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
    async count(filter: EmailLogFilter) {
      const conditions: SQL[] = [];
      if (filter.to !== undefined) conditions.push(eq(emailLog.to, filter.to));
      if (filter.kind !== undefined) conditions.push(eq(emailLog.kind, filter.kind));
      if (filter.relatedType !== undefined) {
        conditions.push(eq(emailLog.relatedType, filter.relatedType));
      }
      if (filter.relatedId !== undefined) conditions.push(eq(emailLog.relatedId, filter.relatedId));
      if (filter.status !== undefined) conditions.push(eq(emailLog.status, filter.status));
      if (filter.sentSince !== undefined) conditions.push(gte(emailLog.sentAt, filter.sentSince));

      const rows = await db
        .select({ value: count() })
        .from(emailLog)
        .where(conditions.length ? and(...conditions) : undefined);
      return rows[0]?.value ?? 0;
    },
    async create(input: NewEmailLog) {
      const [row] = await db.insert(emailLog).values(input).returning();
      return emailLogSchema.parse(row);
    },
  };
}
