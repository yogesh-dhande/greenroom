import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  submissionSchema,
  submissionSpeakerSchema,
  submissionTrackSchema,
  type NewSubmission,
} from "@/db/entities";
import { submissionSpeakers, submissionTracks, submissions } from "@/db/schema";
import type { SubmissionsRepo } from "@/db/repos/submissions";
import type { DrizzleD1 } from "./client";

export function createSubmissionsRepo(db: DrizzleD1): SubmissionsRepo {
  /** Fetches full submissions for a set of ids, newest first. */
  async function byIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await db.query.submissions.findMany({
      where: inArray(submissions.id, ids),
      orderBy: [desc(submissions.createdAt)],
    });
    return rows.map((r) => submissionSchema.parse(r));
  }

  return {
    async getById(id) {
      const row = await db.query.submissions.findFirst({ where: eq(submissions.id, id) });
      return row ? submissionSchema.parse(row) : null;
    },
    async getByResumeToken(token) {
      const row = await db.query.submissions.findFirst({
        where: eq(submissions.resumeToken, token),
      });
      return row ? submissionSchema.parse(row) : null;
    },
    async listByEvent(eventId) {
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.eventId, eventId),
        orderBy: [desc(submissions.createdAt)],
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listByForm(formId) {
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.formId, formId),
        orderBy: [desc(submissions.createdAt)],
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listByFormAndSpeaker(formId, userId) {
      const links = await db.query.submissionSpeakers.findMany({
        where: and(eq(submissionSpeakers.userId, userId), eq(submissionSpeakers.role, "primary")),
      });
      if (links.length === 0) return [];
      const rows = await db.query.submissions.findMany({
        where: and(
          eq(submissions.formId, formId),
          inArray(
            submissions.id,
            links.map((l) => l.submissionId),
          ),
        ),
        orderBy: [desc(submissions.createdAt)],
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listAllByStatus(status) {
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.status, status),
        orderBy: [desc(submissions.createdAt)],
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async countByForms(formIds) {
      const counts: Record<string, number> = Object.fromEntries(formIds.map((id) => [id, 0]));
      if (formIds.length === 0) return counts;
      const rows = await db
        .select({ formId: submissions.formId, total: count() })
        .from(submissions)
        .where(inArray(submissions.formId, formIds))
        .groupBy(submissions.formId);
      for (const row of rows) counts[row.formId] = Number(row.total);
      return counts;
    },
    async listByStatus(eventId, status) {
      const rows = await db.query.submissions.findMany({
        where: and(eq(submissions.eventId, eventId), eq(submissions.status, status)),
        orderBy: [desc(submissions.createdAt)],
      });
      return rows.map((r) => submissionSchema.parse(r));
    },
    async listByTracks(trackIds) {
      if (trackIds.length === 0) return [];
      const links = await db.query.submissionTracks.findMany({
        where: inArray(submissionTracks.trackId, trackIds),
      });
      return byIds([...new Set(links.map((l) => l.submissionId))]);
    },
    async listBySpeaker(userId) {
      const links = await db.query.submissionSpeakers.findMany({
        where: eq(submissionSpeakers.userId, userId),
      });
      return byIds(links.map((l) => l.submissionId));
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

    async listTrackIds(submissionId) {
      const links = await db.query.submissionTracks.findMany({
        where: eq(submissionTracks.submissionId, submissionId),
      });
      return links.map((l) => l.trackId);
    },
    async listTracksBySubmissionIds(submissionIds) {
      if (submissionIds.length === 0) return [];
      const links = await db.query.submissionTracks.findMany({
        where: inArray(submissionTracks.submissionId, submissionIds),
      });
      return links.map((l) => submissionTrackSchema.parse(l));
    },
    async setTracks(submissionId, trackIds) {
      await db.delete(submissionTracks).where(eq(submissionTracks.submissionId, submissionId));
      if (trackIds.length === 0) return;
      await db
        .insert(submissionTracks)
        .values([...new Set(trackIds)].map((trackId) => ({ submissionId, trackId })))
        .onConflictDoNothing();
    },

    async listSpeakers(submissionId) {
      const links = await db.query.submissionSpeakers.findMany({
        where: eq(submissionSpeakers.submissionId, submissionId),
      });
      return links.map((l) => submissionSpeakerSchema.parse(l));
    },
    async listSpeakersBySubmissionIds(submissionIds) {
      if (submissionIds.length === 0) return [];
      const links = await db.query.submissionSpeakers.findMany({
        where: inArray(submissionSpeakers.submissionId, submissionIds),
      });
      return links.map((l) => submissionSpeakerSchema.parse(l));
    },
    async addSpeaker(submissionId, userId, role) {
      await db
        .insert(submissionSpeakers)
        .values({ submissionId, userId, role })
        .onConflictDoUpdate({
          target: [submissionSpeakers.submissionId, submissionSpeakers.userId],
          set: { role },
        });
    },
    async removeSpeaker(submissionId, userId) {
      await db
        .delete(submissionSpeakers)
        .where(
          and(
            eq(submissionSpeakers.submissionId, submissionId),
            eq(submissionSpeakers.userId, userId),
          ),
        );
    },
  };
}
