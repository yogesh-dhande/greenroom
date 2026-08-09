"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { taskTypeSchema } from "@/db/entities";
import { fromZonedInputValue } from "@/domain/forms";
import { planAssignToConfirmedSpeakers } from "@/domain/task-assign";
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

// ---------------------------------------------------------------------------
// Catch a task up to speakers already confirmed (spec.md §5, D-052)
// ---------------------------------------------------------------------------

/**
 * Attaches a task to every speaker already confirmed for the event, in one
 * action from the task list — the fix for the baseline defect where a task
 * created after acceptance never reached anyone because it only attached via
 * "auto-assign on acceptance".
 *
 * "Confirmed" is read the same way the speakers roster computes it
 * (src/app/admin/[eventSlug]/speakers/page.tsx, decisions.md D-017): every
 * speaker who appears on any session for this event, via the session-speaker
 * links acceptance conversion (or direct entry) already writes. No new repo
 * method needed — this composes `sessions.listByEvent` +
 * `sessions.listSpeakersBySessionIds`, the same reads the roster uses.
 *
 * Idempotent by construction: `planAssignToConfirmedSpeakers`
 * (src/domain/task-assign.ts) only ever plans the speakers who don't already
 * hold the task, so a repeat click can't duplicate a row or reset one that's
 * already complete.
 */
export async function assignTaskToConfirmedSpeakers(eventSlug: string, taskId: string) {
  await requireAdmin(`/admin/${eventSlug}/tasks`);
  const repos = await getRepos();

  const [event, task] = await Promise.all([repos.events.getBySlug(eventSlug), repos.tasks.getById(taskId)]);
  if (!event || !task || task.eventId !== event.id) return fail("That task no longer exists");

  try {
    const sessions = await repos.sessions.listByEvent(event.id);
    const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
      sessions.map((session) => session.id),
    );
    const confirmedSpeakerIds = [...new Set(sessionSpeakerRows.map((row) => row.userId))];

    const existingAssignments = await repos.taskAssignments.listByTask(taskId);

    const plan = planAssignToConfirmedSpeakers({
      taskId,
      confirmedSpeakerIds,
      existingAssignments,
    });

    for (const assignment of plan.newAssignments) {
      await repos.taskAssignments.create(assignment);
    }

    revalidatePath(`/admin/${eventSlug}/tasks`);
    revalidatePath(`/admin/${eventSlug}/speakers`);
    revalidatePath("/portal");
    return {
      ok: true as const,
      data: {
        assignedCount: plan.newAssignments.length,
        confirmedCount: confirmedSpeakerIds.length,
      },
    };
  } catch {
    return fail("Couldn't assign the task — try again");
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
