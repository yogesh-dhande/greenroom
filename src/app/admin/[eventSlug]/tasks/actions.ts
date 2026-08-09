"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { taskTypeSchema } from "@/db/entities";
import { fromZonedInputValue } from "@/domain/forms";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

function fail(error: string) {
  return { ok: false as const, error };
}

const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    instructions: z.string().trim().optional(),
    type: taskTypeSchema,
    /** Only meaningful when `type` is "form" — which form the speaker fills
     * out. */
    formId: z.string().trim().optional(),
    /** "YYYY-MM-DDTHH:MM" wall-clock in the event's timezone, or "" for no
     * due date. */
    dueAt: z.string().trim().optional(),
    autoAssignOnAccept: z.boolean(),
  })
  .refine((v) => v.type !== "form" || Boolean(v.formId), {
    message: "Choose which form this task collects",
    path: ["formId"],
  });
export type TaskInput = z.infer<typeof taskInputSchema>;

// ---------------------------------------------------------------------------
// Create / update / delete task templates (spec.md §6, §8)
// ---------------------------------------------------------------------------

export async function createTask(eventSlug: string, input: TaskInput) {
  await requireAdmin(`/admin/${eventSlug}/tasks`);
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid task");
  const v = parsed.data;

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("That event no longer exists");

  if (v.type === "form" && v.formId) {
    const form = await repos.forms.getById(v.formId);
    if (!form || form.eventId !== event.id) return fail("Choose a form that belongs to this event");
  }

  try {
    await repos.tasks.create({
      eventId: event.id,
      title: v.title,
      instructions: v.instructions?.trim() || null,
      type: v.type,
      formId: v.type === "form" ? (v.formId ?? null) : null,
      dueAt: fromZonedInputValue(v.dueAt ?? "", event.timezone),
      autoAssignOnAccept: v.autoAssignOnAccept,
    });
    revalidatePath(`/admin/${eventSlug}/tasks`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't create the task — try again");
  }
}

export async function updateTask(eventSlug: string, taskId: string, input: TaskInput) {
  await requireAdmin(`/admin/${eventSlug}/tasks`);
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid task");
  const v = parsed.data;

  const repos = await getRepos();
  const [event, task] = await Promise.all([repos.events.getBySlug(eventSlug), repos.tasks.getById(taskId)]);
  if (!event || !task || task.eventId !== event.id) return fail("That task no longer exists");

  if (v.type === "form" && v.formId) {
    const form = await repos.forms.getById(v.formId);
    if (!form || form.eventId !== event.id) return fail("Choose a form that belongs to this event");
  }

  try {
    await repos.tasks.update(taskId, {
      title: v.title,
      instructions: v.instructions?.trim() || null,
      type: v.type,
      formId: v.type === "form" ? (v.formId ?? null) : null,
      dueAt: fromZonedInputValue(v.dueAt ?? "", event.timezone),
      autoAssignOnAccept: v.autoAssignOnAccept,
    });
    revalidatePath(`/admin/${eventSlug}/tasks`);
    revalidatePath(`/admin/${eventSlug}/speakers`);
    revalidatePath("/portal");
    return { ok: true } as const;
  } catch {
    return fail("Couldn't save the task — try again");
  }
}

export async function deleteTask(eventSlug: string, taskId: string) {
  await requireAdmin(`/admin/${eventSlug}/tasks`);
  const repos = await getRepos();

  try {
    // Assignments cascade-delete with their task at the database layer
    // (src/db/schema.ts) — nothing to reassign first, unlike tracks/rooms.
    await repos.tasks.delete(taskId);
    revalidatePath(`/admin/${eventSlug}/tasks`);
    revalidatePath(`/admin/${eventSlug}/speakers`);
    revalidatePath("/portal");
    return { ok: true } as const;
  } catch {
    return fail("Couldn't delete the task — try again");
  }
}
