"use server";

import { revalidatePath } from "next/cache";
import { MAX_COMMENT_LENGTH } from "@/domain/files";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import type { SchemaFormResult } from "@/components/schema-form/types";

/**
 * The organizer's half of a deliverable's thread (decisions.md D-054) — the
 * speaker posts to the same list from their portal task card.
 *
 * The assignment id arrives from the client, so it is re-checked against the
 * event in the URL: an admin of one event can't comment their way into
 * another event's deliverable.
 */
export async function postDeliverableComment(
  eventSlug: string,
  assignmentId: string,
  body: string,
): Promise<SchemaFormResult> {
  const user = await requireAdmin(`/admin/${eventSlug}/files`);

  const trimmed = body.trim().slice(0, MAX_COMMENT_LENGTH);
  if (!trimmed) return { ok: false, error: "Write something first." };

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return { ok: false, error: "That event no longer exists." };

  const assignment = await repos.taskAssignments.getById(assignmentId);
  const task = assignment ? await repos.tasks.getById(assignment.taskId) : null;
  if (!assignment || !task || task.eventId !== event.id) {
    return { ok: false, error: "That upload isn't part of this event." };
  }

  await repos.fileComments.create({
    assignmentId: assignment.id,
    authorId: user.id,
    body: trimmed,
  });

  revalidatePath(`/admin/${eventSlug}/files`);
  // The speaker reads the same thread on their task card.
  revalidatePath("/portal");
  return { ok: true, message: "Comment posted." };
}
