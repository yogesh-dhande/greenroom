"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Event } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { taskTypeSchema } from "@/db/entities";
import { sendTaskAssignmentNotification } from "@/domain/comms";
import { fromZonedInputValue } from "@/domain/forms";
import {
  planAssignToConfirmedSpeakers,
  planAssignToSpeakers,
  resolveAssigneeSpeakerIds,
  TASK_ASSIGNEE_MODES,
} from "@/domain/task-assign";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireAdmin, type SessionUser } from "@/lib/session";
import { loadSpeakerRoster } from "../speakers/roster";

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
    /** Who this task is aimed at (decisions.md D-069). Absent from an older
     * caller means "all confirmed speakers" — the behaviour that predates
     * the control. */
    assigneeMode: z.enum(TASK_ASSIGNEE_MODES).optional(),
    /** Ticked speakers; only read when `assigneeMode` is "selected". */
    assigneeSpeakerIds: z.array(z.string()).optional(),
  })
  .refine((v) => v.type !== "form" || Boolean(v.formId), {
    message: "Choose which form this task collects",
    path: ["formId"],
  })
  .refine(
    (v) => v.assigneeMode !== "selected" || (v.assigneeSpeakerIds ?? []).length > 0,
    { message: "Pick at least one speaker, or assign to all confirmed speakers", path: ["assigneeSpeakerIds"] },
  );
export type TaskInput = z.infer<typeof taskInputSchema>;

/**
 * Assigns a freshly saved task to the speakers the organizer picked
 * (decisions.md D-069).
 *
 * Only the "selected" mode writes anything: "all confirmed speakers" is the
 * default and means what it has always meant — the task reaches speakers as
 * their talks are accepted (`autoAssignOnAccept`) and the task list's
 * one-click action catches up whoever is already confirmed — so saving a
 * task never fans it out to a whole roster behind the organizer's back.
 *
 * The selection is intersected with this event's roster before anything is
 * written (`resolveAssigneeSpeakerIds`): speaker ids are user ids, and a
 * server action is a public endpoint, so an id posted by hand must not be
 * able to attach a stranger's account to this event's task.
 *
 * Idempotent through the same `planAssignToSpeakers` dedupe every other
 * assignment path uses — re-saving a task with the same people ticked adds
 * nothing and touches no existing row, so nobody's completed work is reset.
 */
async function applyAssigneeSelection(
  repos: Repos,
  event: Event,
  taskId: string,
  input: TaskInput,
): Promise<string[]> {
  if (input.assigneeMode !== "selected") return [];
  const selectedSpeakerIds = input.assigneeSpeakerIds ?? [];
  if (selectedSpeakerIds.length === 0) return [];

  const { rollups } = await loadSpeakerRoster(repos, event.id);
  const speakerIds = resolveAssigneeSpeakerIds({
    mode: "selected",
    selectedSpeakerIds,
    rosterSpeakerIds: rollups.map((rollup) => rollup.speaker.id),
  });
  if (speakerIds.length === 0) return [];

  const plan = planAssignToSpeakers({
    taskId,
    speakerIds,
    existingAssignments: await repos.taskAssignments.listByTask(taskId),
  });
  const createdIds: string[] = [];
  for (const assignment of plan.newAssignments) {
    createdIds.push((await repos.taskAssignments.create(assignment)).id);
  }
  return createdIds;
}

/**
 * The one-time "you've been given a task" email (decisions.md D-039: an
 * assignment notification and a weekly digest are the only two task emails a
 * speaker gets).
 *
 * Takes the ids of assignments *this* call created, never the task's whole
 * assignment list — every assign path is idempotent, and a speaker who
 * already held the task must not be told again each time an organizer
 * re-runs one.
 *
 * A failed send is logged, not returned: the assignment is written and the
 * task really is on the speaker's portal, so failing the action here would
 * report the opposite of what happened (same handling as the confirmation
 * send in src/app/portal/submissions/[id]/actions.ts). `organizerName` is the
 * admin who pressed the button, per D-053(2).
 */
async function notifyNewAssignments(repos: Repos, admin: SessionUser, assignmentIds: string[]) {
  if (assignmentIds.length === 0) return;
  try {
    const comms = await getCommsContext({
      repos,
      organizerName: admin.name?.trim() || admin.email,
      organizerEmail: admin.email,
    });
    await sendTaskAssignmentNotification(comms, { assignmentIds });
  } catch (error) {
    console.error("task assignment notification failed", error);
  }
}

/** Every surface a new assignment can show up on. */
function revalidateAssignmentSurfaces(eventSlug: string) {
  revalidatePath(`/admin/${eventSlug}/tasks`);
  revalidatePath(`/admin/${eventSlug}/speakers`, "layout");
  revalidatePath("/portal");
}

// ---------------------------------------------------------------------------
// Create / update / delete task templates (spec.md §6, §8)
// ---------------------------------------------------------------------------

export async function createTask(eventSlug: string, input: TaskInput) {
  const admin = await requireAdmin(`/admin/${eventSlug}/tasks`);
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

  let task;
  try {
    task = await repos.tasks.create({
      eventId: event.id,
      title: v.title,
      instructions: v.instructions?.trim() || null,
      type: v.type,
      formId: v.type === "form" ? (v.formId ?? null) : null,
      dueAt: fromZonedInputValue(v.dueAt ?? "", event.timezone),
      autoAssignOnAccept: v.autoAssignOnAccept,
    });
  } catch {
    return fail("Couldn't create the task — try again");
  }

  // The task exists from here on, so a failure to assign is reported as such
  // rather than as a failed creation — telling an organizer their task wasn't
  // created when it was is the worse lie, and re-saving is idempotent anyway.
  let assignedIds: string[] = [];
  let assignFailed = false;
  try {
    assignedIds = await applyAssigneeSelection(repos, event, task.id, v);
  } catch {
    assignFailed = true;
  }
  await notifyNewAssignments(repos, admin, assignedIds);

  revalidateAssignmentSurfaces(eventSlug);
  return { ok: true as const, data: { assignedCount: assignedIds.length, assignFailed } };
}

export async function updateTask(eventSlug: string, taskId: string, input: TaskInput) {
  const admin = await requireAdmin(`/admin/${eventSlug}/tasks`);
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

  const nextFormId = v.type === "form" ? (v.formId ?? null) : null;
  if (v.type !== task.type || nextFormId !== task.formId) {
    // What a task *is* is frozen once anyone holds it. Assignments carry the
    // work filed against the old shape and are never rewritten to match
    // (D-052, D-069 — completion is never reset by an assignment path), so a
    // confirmation someone completed would stay "Complete" as an upload with
    // no file and no way to redo it. The honest fix is a second task.
    const existingAssignments = await repos.taskAssignments.listByTask(taskId);
    if (existingAssignments.length > 0) {
      return fail(
        `This task is already assigned to ${existingAssignments.length} speaker${
          existingAssignments.length === 1 ? "" : "s"
        } — its type and form can't change, or the work they've already filed would be stranded. Create a new task instead. Title, instructions and due date can still be edited here.`,
      );
    }
  }

  try {
    await repos.tasks.update(taskId, {
      title: v.title,
      instructions: v.instructions?.trim() || null,
      type: v.type,
      formId: nextFormId,
      dueAt: fromZonedInputValue(v.dueAt ?? "", event.timezone),
      autoAssignOnAccept: v.autoAssignOnAccept,
    });
  } catch {
    return fail("Couldn't save the task — try again");
  }

  // Editing only ever *adds* assignees. Un-ticking someone doesn't unassign
  // them: their row may already carry submitted work, and silently deleting
  // that on a title edit is exactly the kind of loss the idempotency rule
  // exists to prevent (D-052, D-069). Removal stays an explicit act.
  let assignedIds: string[] = [];
  let assignFailed = false;
  try {
    assignedIds = await applyAssigneeSelection(repos, event, taskId, v);
  } catch {
    assignFailed = true;
  }
  await notifyNewAssignments(repos, admin, assignedIds);

  revalidateAssignmentSurfaces(eventSlug);
  return { ok: true as const, data: { assignedCount: assignedIds.length, assignFailed } };
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
 * "Confirmed" is the *effective* status the speakers roster computes
 * (decisions.md D-068, `resolveConfirmation`): the organizer's stored answer
 * on the speaker's `event_speakers` record when there is one, else whether
 * they're on any session for this event via acceptance conversion or direct
 * entry (D-017). Reusing `loadSpeakerRoster` rather than re-deriving from
 * `sessions.listSpeakersBySessionIds` directly means a speaker explicitly
 * marked Declined can't be caught by this bulk action just because nobody's
 * unpicked their session yet — the gap D-068 closes.
 *
 * Idempotent by construction: `planAssignToConfirmedSpeakers`
 * (src/domain/task-assign.ts) only ever plans the speakers who don't already
 * hold the task, so a repeat click can't duplicate a row or reset one that's
 * already complete.
 */
export async function assignTaskToConfirmedSpeakers(eventSlug: string, taskId: string) {
  const admin = await requireAdmin(`/admin/${eventSlug}/tasks`);
  const repos = await getRepos();

  const [event, task] = await Promise.all([repos.events.getBySlug(eventSlug), repos.tasks.getById(taskId)]);
  if (!event || !task || task.eventId !== event.id) return fail("That task no longer exists");

  try {
    const { rollups } = await loadSpeakerRoster(repos, event.id);
    const confirmedSpeakerIds = rollups
      .filter((rollup) => rollup.confirmed)
      .map((rollup) => rollup.speaker.id);

    const existingAssignments = await repos.taskAssignments.listByTask(taskId);

    const plan = planAssignToConfirmedSpeakers({
      taskId,
      confirmedSpeakerIds,
      existingAssignments,
    });

    const createdIds: string[] = [];
    for (const assignment of plan.newAssignments) {
      createdIds.push((await repos.taskAssignments.create(assignment)).id);
    }
    // Only the speakers this click actually added hear about it — the ones
    // who already held the task were notified when they got it (D-039).
    await notifyNewAssignments(repos, admin, createdIds);

    revalidateAssignmentSurfaces(eventSlug);
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
    revalidateAssignmentSurfaces(eventSlug);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't delete the task — try again");
  }
}
