"use server";

import { revalidatePath } from "next/cache";
import { validateSubmissionValues, type FormValues } from "@/domain/forms";
import { assignmentFileRef, MAX_COMMENT_LENGTH } from "@/domain/files";
import { filenameFromKey, fileUrl, isServableKey } from "@/lib/uploads";
import { getRepos } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import type { SchemaFormResult } from "@/components/schema-form/types";
import type { Repos } from "@/db/repos";
import type { Task, TaskAssignment } from "@/db/entities";

/**
 * Loads a task assignment and re-verifies it belongs to the signed-in
 * speaker — never trusted from the client, which only supplies an id via a
 * bound server action argument (the same pattern as
 * src/app/portal/submissions/[id]/actions.ts).
 */
async function loadOwnedAssignment(
  assignmentId: string,
  userId: string,
): Promise<{ repos: Repos; assignment: TaskAssignment; task: Task } | null> {
  const repos = await getRepos();
  const assignment = await repos.taskAssignments.getById(assignmentId);
  if (!assignment || assignment.speakerId !== userId) return null;

  const task = await repos.tasks.getById(assignment.taskId);
  if (!task) return null;

  return { repos, assignment, task };
}

/** Refreshes both the speaker's own view and the organizer surfaces that
 * report on it — the onboarding dashboard (spec.md §8) and the files library
 * (decisions.md D-054) — so neither needs a manual reload. */
async function revalidateAfterCompletion(repos: Repos, task: Task): Promise<void> {
  revalidatePath("/portal");
  const event = await repos.events.getById(task.eventId);
  if (!event) return;
  revalidatePath(`/admin/${event.slug}/speakers`);
  revalidatePath(`/admin/${event.slug}/files`);
}

export async function completeConfirmTask(assignmentId: string): Promise<SchemaFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to do this." };

  const loaded = await loadOwnedAssignment(assignmentId, user.id);
  if (!loaded) return { ok: false, error: "That task isn't yours." };
  const { repos, assignment, task } = loaded;
  if (task.type !== "confirm") return { ok: false, error: "That task isn't a confirmation." };

  await repos.taskAssignments.update(assignment.id, {
    status: "completed",
    completedAt: new Date(),
  });

  await revalidateAfterCompletion(repos, task);
  return { ok: true, message: "Marked as done." };
}

export async function completeFormTask(
  assignmentId: string,
  values: FormValues,
): Promise<SchemaFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to save your answers." };

  const loaded = await loadOwnedAssignment(assignmentId, user.id);
  if (!loaded) return { ok: false, error: "That task isn't yours." };
  const { repos, assignment, task } = loaded;
  if (task.type !== "form" || !task.formId) return { ok: false, error: "That task isn't a form." };

  const form = await repos.forms.getById(task.formId);
  if (!form) return { ok: false, error: "That form no longer exists." };

  const validation = validateSubmissionValues(form.fields, values);
  if (!validation.ok) {
    return { ok: false, error: "Some answers need another look.", fieldErrors: validation.errors };
  }

  await repos.taskAssignments.update(assignment.id, {
    status: "completed",
    completedAt: new Date(),
    responseJson: validation.values,
  });

  await revalidateAfterCompletion(repos, task);
  return { ok: true, message: "Saved — thanks!" };
}

/**
 * Records an upload in the assignment's version history (decisions.md D-054).
 *
 * A file uploaded before the versions table existed has no row of its own, so
 * the first replacement writes it as version 1 under the date it was actually
 * sent — that is the whole backfill, and it only ever runs when someone
 * replaces a file.
 */
async function recordFileVersion(
  repos: Repos,
  assignment: TaskAssignment,
  uploadedBy: string,
  next: { key: string; url: string; filename: string },
): Promise<void> {
  const history = await repos.fileVersions.listByAssignment(assignment.id);
  if (history.length === 0) {
    const previous = assignmentFileRef(assignment);
    if (previous) {
      await repos.fileVersions.create({
        assignmentId: assignment.id,
        fileKey: previous.key,
        url: previous.url,
        filename: previous.filename,
        uploadedBy: assignment.speakerId,
        createdAt: previous.uploadedAt,
      });
    }
  }

  await repos.fileVersions.create({
    assignmentId: assignment.id,
    fileKey: next.key,
    url: next.url,
    filename: next.filename,
    uploadedBy,
  });
}

/**
 * Takes delivery of a file for a `file_request` task — the first one or a
 * replacement (decisions.md D-054: the upload control never disappears, and
 * every upload becomes a version).
 *
 * The key comes from `uploadFormFile`, which already put the bytes in R2 and
 * enforced size/type; re-checking it here is about the *shape* of the key, so
 * a hand-made call can't point an assignment at something outside uploads/.
 */
export async function completeFileTask(
  assignmentId: string,
  key: string,
  filename: string,
): Promise<SchemaFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to upload this." };

  const loaded = await loadOwnedAssignment(assignmentId, user.id);
  if (!loaded) return { ok: false, error: "That task isn't yours." };
  const { repos, assignment, task } = loaded;
  if (task.type !== "file_request") return { ok: false, error: "That task isn't a file upload." };

  if (!key) return { ok: false, error: "Choose a file to upload." };
  if (!isServableKey(key)) return { ok: false, error: "That file can't be stored." };

  const replacing = Boolean(assignment.fileUrl);
  const url = fileUrl(key);
  await recordFileVersion(repos, assignment, user.id, {
    key,
    url,
    filename: filename.trim().slice(0, 200) || filenameFromKey(key),
  });

  await repos.taskAssignments.update(assignment.id, {
    status: "completed",
    // A replacement doesn't re-complete the task: the date it was first
    // delivered is what the organizer's deadline reporting is about.
    completedAt: assignment.completedAt ?? new Date(),
    fileUrl: url,
  });

  await revalidateAfterCompletion(repos, task);
  return { ok: true, message: replacing ? "New version uploaded." : "Uploaded — thanks!" };
}

/**
 * A speaker's comment on their own deliverable (decisions.md D-054). The
 * organizer's half of the same thread is posted from Admin > Files.
 */
export async function postTaskComment(
  assignmentId: string,
  body: string,
): Promise<SchemaFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to comment." };

  const loaded = await loadOwnedAssignment(assignmentId, user.id);
  if (!loaded) return { ok: false, error: "That task isn't yours." };
  const { repos, assignment, task } = loaded;

  const trimmed = body.trim().slice(0, MAX_COMMENT_LENGTH);
  if (!trimmed) return { ok: false, error: "Write something first." };

  await repos.fileComments.create({
    assignmentId: assignment.id,
    authorId: user.id,
    body: trimmed,
  });

  await revalidateAfterCompletion(repos, task);
  return { ok: true, message: "Comment posted." };
}
