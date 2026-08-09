"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Form, Task } from "@/db/entities";
import { taskTypeSchema } from "@/db/entities";
import { toZonedInputValue } from "@/domain/forms";
import { Button } from "@/components/ui/button";
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

const TASK_TYPE_LABEL: Record<string, string> = {
  form: "Fill out a form",
  file_request: "Upload a file",
  confirm: "Confirm information",
};

const formSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
    instructions: z.string().trim(),
    type: taskTypeSchema,
    formId: z.string(),
    dueAt: z.string(),
    autoAssignOnAccept: z.boolean(),
  })
  .refine((v) => v.type !== "form" || Boolean(v.formId), {
    message: "Choose which form this task collects",
    path: ["formId"],
  });
type FormValues = z.infer<typeof formSchema>;

function defaultsFor(task: Task | undefined, eventTimezone: string): FormValues {
  return {
    title: task?.title ?? "",
    instructions: task?.instructions ?? "",
    type: task?.type ?? "confirm",
    formId: task?.formId ?? "",
    dueAt: toZonedInputValue(task?.dueAt ?? null, eventTimezone),
    autoAssignOnAccept: task?.autoAssignOnAccept ?? true,
  };
}

/** Create/edit dialog for one task template (spec.md §6, §8). Reuses the
 * dialog + react-hook-form pattern from admin/settings' room dialog. */
export function TaskFormDialog({
  eventSlug,
  eventTimezone,
  forms,
  task,
  trigger,
}: {
  eventSlug: string;
  eventTimezone: string;
  /** The event's forms — offered as the source when `type` is "form". */
  forms: Form[];
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
    defaultValues: defaultsFor(task, eventTimezone),
  });
  const type = useWatch({ control, name: "type" });

  async function onSubmit(values: FormValues) {
    const result = task
      ? await updateTask(eventSlug, task.id, values)
      : await createTask(eventSlug, values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(task ? "Task updated" : "Task created");
    setOpen(false);
    if (!task) reset(defaultsFor(undefined, eventTimezone));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(defaultsFor(task, eventTimezone));
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
                <Select value={field.value} onValueChange={field.onChange}>
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
          </div>

          {type === "form" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-form">Form</Label>
              <Controller
                control={control}
                name="formId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
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
