import { and, eq } from "drizzle-orm";
import { submissionSchema, type NewSubmission } from "@/db/entities";
import { submissions } from "@/db/schema";
import type { SubmissionsRepo } from "@/db/repos/submissions";
import type { DrizzleD1 } from "./client";

export function createSubmissionsRepo(db: DrizzleD1): SubmissionsRepo {
  return {
    async getById(id) {
      const row = await db.query.submissions.findFirst({
        where: eq(submissions.id, id),
      });
      return row ? submissionSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.eventId, eventId),
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listByForm(formId) {
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.formId, formId),
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listBySubmitter(submitterId) {
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.submitterId, submitterId),
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listByStatus(eventId, status) {
      const rows = await db.query.submissions.findMany({
        where: and(eq(submissions.eventId, eventId), eq(submissions.status, status)),
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listByCategory(eventId, category) {
      const rows = await db.query.submissions.findMany({
        where: and(
          eq(submissions.eventId, eventId),
          eq(submissions.category, category),
        ),
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async create(input: NewSubmission) {
      const [row] = await db.insert(submissions).values(input).returning();
      return submissionSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(submissions)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(submissions.id, id))
        .returning();
      return submissionSchema.parse(row);
    },
    async delete(id) {
      await db.delete(submissions).where(eq(submissions.id, id));
    },
  };
}
