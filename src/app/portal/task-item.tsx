"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { Form, Task, TaskAssignment } from "@/db/entities";
import { TASK_STATE_LABEL, type TaskState } from "@/domain/onboarding";
import { formatDate } from "@/components/date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import { completeConfirmTask, completeFileTask, completeFormTask } from "./actions";

/** Overdue/due-soon use the shared `warning`/`destructive` semantic tokens
 * only — never a raw amber class (decisions.md D-018). */
const STATE_BADGE_CLASS: Record<TaskState, string> = {
  complete: "border-border text-muted-foreground",
  open: "border-border text-foreground",
  due_soon: "border-warning bg-warning/10 text-warning",
  overdue: "border-destructive bg-destructive/10 text-destructive",
};

/** The synthetic single-field schema a `file_request` task's completion form
 * uses — reusing SchemaForm's file control rather than a bespoke uploader.
 * The field id must match FILE_FIELD_ID in ./actions.ts. */
const FILE_ONLY_FIELDS = [
  { id: "file", type: "file" as const, label: "Upload a file", required: true },
];

/**
 * One task card in the speaker portal (spec.md §6): what it is, its state,
 * and — while it's still open — the way to complete it, reusing the same
 * SchemaForm/upload machinery as a CFP submission.
 */
export function TaskItem({
  assignment,
  task,
  state,
  form,
}: {
  assignment: TaskAssignment;
  task: Task;
  state: TaskState;
  /** The linked form, resolved by the page, for `type: "form"` tasks. */
  form: Form | null;
}) {
  const [isPending, startTransition] = useTransition();
  const done = assignment.status === "completed";

  function markConfirmed() {
    startTransition(async () => {
      const result = await completeConfirmTask(assignment.id);
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error(result.error);
    });
  }

  return (
    <div
      role="region"
      aria-label={task.title}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{task.title}</p>
          {task.instructions && (
            <p className="mt-0.5 text-sm text-muted-foreground">{task.instructions}</p>
          )}
          {task.dueAt && (
            <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(task.dueAt)}</p>
          )}
        </div>
        <Badge variant="outline" className={STATE_BADGE_CLASS[state]}>
          {TASK_STATE_LABEL[state]}
        </Badge>
      </div>

      {done ? (
        task.type === "file_request" && assignment.fileUrl ? (
          <a
            href={assignment.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            View what you uploaded
          </a>
        ) : null
      ) : task.type === "confirm" ? (
        <div>
          <Button size="sm" disabled={isPending} onClick={markConfirmed}>
            {isPending ? "Saving…" : "Mark as done"}
          </Button>
        </div>
      ) : task.type === "form" && form ? (
        <SchemaForm
          fields={form.fields}
          defaultValues={assignment.responseJson ?? {}}
          submitLabel="Submit"
          pendingLabel="Saving…"
          action={completeFormTask.bind(null, assignment.id)}
          uploadAction={uploadFormFile}
          uploadScope={`task-${task.id}`}
        />
      ) : task.type === "file_request" ? (
        <SchemaForm
          fields={FILE_ONLY_FIELDS}
          defaultValues={{}}
          submitLabel="Upload"
          pendingLabel="Uploading…"
          action={completeFileTask.bind(null, assignment.id)}
          uploadAction={uploadFormFile}
          uploadScope={`task-${task.id}`}
        />
      ) : (
        <p className="text-sm text-destructive">
          This task needs a form linked to it — ask the organizers to check its setup.
        </p>
      )}
    </div>
  );
}
