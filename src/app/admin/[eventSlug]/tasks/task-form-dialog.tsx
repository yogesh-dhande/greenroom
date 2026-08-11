"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Form, Task } from "@/db/entities";
import { taskTypeSchema } from "@/db/entities";
import { toZonedInputValue } from "@/domain/forms";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createTask, updateTask } from "./actions";
import type { TaskSpeakerOption } from "./types";

const TASK_TYPE_LABEL: Record<string, string> = {
  form: "Fill out a form",
  file_request: "Upload a file",
  confirm: "Confirm information",
};

const ASSIGNEE_MODE_LABEL: Record<string, string> = {
  all_confirmed: "All confirmed speakers",
  selected: "Specific speakers",
};

const formSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    instructions: z.string().trim(),
    type: taskTypeSchema,
    formId: z.string(),
    dueAt: z.string(),
    autoAssignOnAccept: z.boolean(),
    assigneeMode: z.enum(["all_confirmed", "selected"]),
    assigneeSpeakerIds: z.array(z.string()),
    allowDuplicate: z.boolean(),
  })
  .refine((v) => v.type !== "form" || Boolean(v.formId), {
    message: "Choose which form this task collects",
    path: ["formId"],
  })
  .refine((v) => v.assigneeMode !== "selected" || v.assigneeSpeakerIds.length > 0, {
    message: "Tick at least one speaker, or assign to all confirmed speakers",
    path: ["assigneeSpeakerIds"],
  });
type FormValues = z.infer<typeof formSchema>;

function defaultsFor(
  task: Task | undefined,
  eventTimezone: string,
  assignedSpeakerIds: string[],
): FormValues {
  return {
    title: task?.title ?? "",
    instructions: task?.instructions ?? "",
    type: task?.type ?? "confirm",
    formId: task?.formId ?? "",
    dueAt: toZonedInputValue(task?.dueAt ?? null, eventTimezone),
    autoAssignOnAccept: task?.autoAssignOnAccept ?? true,
    // "All confirmed speakers" is the default on create *and* on edit: the
    // mode is an instruction for this save, not a stored property of the
    // task, so re-opening a task must not imply it's limited to whoever was
    // picked last time.
    assigneeMode: "all_confirmed",
    // Speakers who already hold the task start ticked and stay ticked — the
    // dialog can add assignees, never remove them (their rows may already
    // carry submitted work).
    assigneeSpeakerIds: assignedSpeakerIds,
    allowDuplicate: false,
  };
}

/** Create/edit dialog for one task template (spec.md §6, §8). Reuses the
 * dialog + react-hook-form pattern from admin/settings' room dialog.
 *
 * Also where a task is aimed (decisions.md D-069): "All confirmed speakers"
 * is the default and behaves exactly as it always has — the task reaches
 * speakers as their talks are accepted, and the task list's assign action
 * catches up anyone already confirmed. "Specific speakers" is the targeted
 * case, assigned the moment the task is saved. */
export function TaskFormDialog({
  eventSlug,
  eventTimezone,
  forms,
  speakers,
  assignedSpeakerIds = [],
  task,
  trigger,
}: {
  eventSlug: string;
  eventTimezone: string;
  /** The event's forms — offered as the source when `type` is "form". */
  forms: Form[];
  /** This event's roster, for the "Specific speakers" case. */
  speakers: TaskSpeakerOption[];
  /** Who already holds this task — ticked and locked, since assignment here
   * only ever adds. Empty when creating. */
  assignedSpeakerIds?: string[];
  task?: Task;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultsFor(task, eventTimezone, assignedSpeakerIds),
  });
  const type = useWatch({ control, name: "type" });
  const assigneeMode = useWatch({ control, name: "assigneeMode" });
  const alreadyAssigned = new Set(assignedSpeakerIds);
  // What a task *is* is frozen once anyone holds it: their assignment carries
  // work filed against the old shape, and nothing rewrites it to match — a
  // completed confirmation turned into an upload would read "Complete" with no
  // file. The server refuses the same change (./actions.ts updateTask); this
  // just stops the organizer discovering that after typing.
  const shapeLocked = Boolean(task) && assignedSpeakerIds.length > 0;

  async function onSubmit(values: FormValues) {
    const result = task
      ? await updateTask(eventSlug, task.id, values)
      : await createTask(eventSlug, values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }

    const saved = task ? "Task updated" : "Task created";
    const { assignedCount, assignFailed } = result.data;
    if (assignFailed) {
      toast.warning(`${saved}, but assigning it failed — try again from the task list`);
    } else if (assignedCount > 0) {
      toast.success(
        `${saved} · assigned to ${assignedCount} speaker${assignedCount === 1 ? "" : "s"}`,
      );
    } else if (values.assigneeMode === "selected") {
      toast.success(`${saved} — everyone you picked already had it`);
    } else {
      toast.success(saved);
    }

    setOpen(false);
    if (!task) reset(defaultsFor(undefined, eventTimezone, []));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(defaultsFor(task, eventTimezone, assignedSpeakerIds));
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input id="task-title" placeholder="Upload your slides" {...register("title")} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-instructions">Instructions (optional)</Label>
            <Textarea
              id="task-instructions"
              rows={3}
              placeholder="What the speaker needs to do and why."
              {...register("instructions")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-type">Type</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={shapeLocked}>
                  <SelectTrigger id="task-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {shapeLocked && (
              <p className="text-xs text-muted-foreground">
                {assignedSpeakerIds.length === 1
                  ? "A speaker already has this task"
                  : `${assignedSpeakerIds.length} speakers already have this task`}
                , so its type and form are fixed — changing them would strand the work
                they&apos;ve filed. Create a new task to collect something different. Title,
                instructions and due date can still be edited.
              </p>
            )}
          </div>

          {type === "form" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-form">Form</Label>
              <Controller
                control={control}
                name="formId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={shapeLocked}>
                    <SelectTrigger id="task-form" className="w-full">
                      <SelectValue placeholder="Choose a form…" />
                    </SelectTrigger>
                    <SelectContent>
                      {forms.map((form) => (
                        <SelectItem key={form.id} value={form.id}>
                          {form.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.formId && <p className="text-sm text-destructive">{errors.formId.message}</p>}
              {forms.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Build a form on the Forms tab first, then come back to link it here.
                </p>
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due">Due (optional)</Label>
            <Input id="task-due" type="datetime-local" {...register("dueAt")} />
            <p className="text-xs text-muted-foreground">
              Times are in the event&apos;s timezone ({eventTimezone}).
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-assignee-mode">Who gets this task</Label>
            <Controller
              control={control}
              name="assigneeMode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="task-assignee-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSIGNEE_MODE_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {assigneeMode === "selected" ? (
              <p className="text-xs text-muted-foreground">
                Only the speakers you tick, assigned as soon as you save. Nobody is unassigned
                here — untick someone and their existing task stays as it is.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Speakers get this task as their talks are accepted. Use the assign action on the
                task list to catch up anyone already confirmed.
              </p>
            )}
          </div>

          {assigneeMode === "selected" ? (
            <Controller
              control={control}
              name="assigneeSpeakerIds"
              render={({ field }) => (
                <div className="flex max-h-56 flex-col gap-2.5 overflow-y-auto rounded-md border border-border px-3 py-2.5">
                  {speakers.length === 0 ? (
                    <EmptyState
                      variant="inline"
                      title="No speakers on this event's roster yet."
                      description="Add one from the Speakers page, or accept a proposal, and they'll show up here."
                    />
                  ) : (
                    speakers.map((speaker) => {
                      const held = alreadyAssigned.has(speaker.id);
                      const inputId = `task-assignee-${task?.id ?? "new"}-${speaker.id}`;
                      return (
                        <div key={speaker.id} className="flex items-center gap-2.5">
                          <Checkbox
                            id={inputId}
                            // A speaker who already holds the task can't be
                            // unticked: this dialog adds assignments, it
                            // never deletes work.
                            disabled={held}
                            checked={field.value.includes(speaker.id)}
                            onCheckedChange={(checked) =>
                              field.onChange(
                                checked === true
                                  ? [...field.value, speaker.id]
                                  : field.value.filter((id) => id !== speaker.id),
                              )
                            }
                          />
                          <Label htmlFor={inputId} className="flex-1 font-normal">
                            {speaker.name}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {speaker.email}
                            </span>
                          </Label>
                          {held ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              Already has it
                            </Badge>
                          ) : speaker.confirmed ? null : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Not confirmed
                            </Badge>
                          )}
                        </div>
                      );
                    })
                  )}
                  {errors.assigneeSpeakerIds && (
                    <p className="text-sm text-destructive">
                      {errors.assigneeSpeakerIds.message}
                    </p>
                  )}
                </div>
              )}
            />
          ) : null}

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="task-auto-assign" className="font-normal">
                Auto-assign on acceptance
              </Label>
              <p className="text-xs text-muted-foreground">
                Every speaker gets this task the moment their talk is accepted.
              </p>
            </div>
            <Controller
              control={control}
              name="autoAssignOnAccept"
              render={({ field }) => (
                <Switch
                  id="task-auto-assign"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          {!task ? (
            <div className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5">
              <Controller
                control={control}
                name="allowDuplicate"
                render={({ field }) => (
                  <Checkbox
                    id="task-allow-duplicate"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="task-allow-duplicate" className="font-normal">
                  Create it anyway
                </Label>
                <p className="text-xs text-muted-foreground">
                  Allow a second task with the same title, type, and due date when the duplicate
                  is intentional.
                </p>
              </div>
            </div>
          ) : null}

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : task ? "Save changes" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
