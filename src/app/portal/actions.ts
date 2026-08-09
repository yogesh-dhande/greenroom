"use server";

import { revalidatePath } from "next/cache";
import { validateSubmissionValues, type FormValues } from "@/domain/forms";
import { fileUrl } from "@/lib/uploads";
import { getRepos } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import type { SchemaFormResult } from "@/components/schema-form/types";
import type { Repos } from "@/db/repos";
import type { Task, TaskAssignment } from "@/db/entities";

/** The single synthetic field a `file_request` task's completion form uses —
 * mirrored in ./task-item.tsx, which is why it's called out here. */
const FILE_FIELD_ID = "file";

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

/** Refreshes both the speaker's own view and the admin onboarding dashboard
 * (spec.md §8) so a completed task shows up there without a manual reload. */
async function revalidateAfterCompletion(repos: Repos, task: Task): Promise<void> {
  revalidatePath("/portal");
  const event = await repos.events.getById(task.eventId);
  if (event) revalidatePath(`/admin/${event.slug}/speakers`);
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

export async function completeFileTask(
  assignmentId: string,
  values: FormValues,
): Promise<SchemaFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to upload this." };

  const loaded = await loadOwnedAssignment(assignmentId, user.id);
  if (!loaded) return { ok: false, error: "That task isn't yours." };
  const { repos, assignment, task } = loaded;
  if (task.type !== "file_request") return { ok: false, error: "That task isn't a file upload." };

  const key = typeof values[FILE_FIELD_ID] === "string" ? (values[FILE_FIELD_ID] as string) : "";
  if (!key) {
    return {
      ok: false,
      error: "Choose a file to upload.",
      fieldErrors: { [FILE_FIELD_ID]: "A file is required" },
    };
  }

  await repos.taskAssignments.update(assignment.id, {
    status: "completed",
    completedAt: new Date(),
    fileUrl: fileUrl(key),
  });

  await revalidateAfterCompletion(repos, task);
  return { ok: true, message: "Uploaded — thanks!" };
}
