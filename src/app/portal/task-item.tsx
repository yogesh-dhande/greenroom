"use client";

import { useState, useTransition } from "react";
import { LoaderCircleIcon, PaperclipIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Form, Task, TaskAssignment } from "@/db/entities";
import { TASK_STATE_LABEL, type TaskState } from "@/domain/onboarding";
import { inferUploadKind, type CommentView, type FileHistory } from "@/domain/files";
import {
  acceptAttributeForKind,
  checkUpload,
  fileUrl,
  uploadProblemMessage,
  uploadRulesHint,
  type UploadKind,
} from "@/lib/uploads";
import { formatDueDate } from "@/lib/event-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileCommentThread, FileVersionList } from "@/components/file-thread";
import { SchemaForm } from "@/components/schema-form/schema-form";
import { uploadFormFile } from "@/app/upload-actions";
import {
  completeConfirmTask,
  completeFileTask,
  completeFormTask,
  postTaskComment,
} from "./actions";

/** Overdue/due-soon use the shared `warning`/`destructive` semantic tokens
 * only — never a raw amber class (decisions.md D-018). */
const STATE_BADGE_CLASS: Record<TaskState, string> = {
  complete: "border-border text-muted-foreground",
  open: "border-border text-foreground",
  due_soon: "border-warning bg-warning/10 text-warning",
  overdue: "border-destructive bg-destructive/10 text-destructive",
};

/**
 * The upload control for a `file_request` task — the first delivery and every
 * replacement (decisions.md D-054).
 *
 * The file goes to R2 as soon as it's picked and the form value is the
 * returned key, exactly like the CFP form's file question; what differs is
 * that this one never goes away once the task is complete, so a speaker who
 * sent the wrong deck can send the right one.
 */
function FileUploadControl({
  assignmentId,
  taskId,
  kind,
  submitLabel,
  onUploaded,
}: {
  assignmentId: string;
  taskId: string;
  /** What the task is asking for — narrows the picker and states the rule. */
  kind: UploadKind;
  submitLabel: string;
  onUploaded: () => void;
}) {
  const inputId = `task-file-${assignmentId}`;
  const [picked, setPicked] = useState<{ key: string; filename: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  function save() {
    if (!picked) return;
    startTransition(async () => {
      const result = await completeFileTask(assignmentId, picked.key, picked.filename);
      if (result.ok) {
        toast.success(result.message ?? "Uploaded");
        setPicked(null);
        onUploaded();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>Upload a file</Label>

      {picked ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
          <a
            href={fileUrl(picked.key)}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm text-primary underline-offset-4 hover:underline"
          >
            {picked.filename}
          </a>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Remove the picked file"
            onClick={() => setPicked(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="file"
            accept={acceptAttributeForKind(kind)}
            disabled={busy}
            className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium file:text-secondary-foreground"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setProblem(null);
              const invalid = checkUpload(file, kind);
              if (invalid) {
                setProblem(uploadProblemMessage(invalid, kind));
                event.target.value = "";
                return;
              }
              setBusy(true);
              try {
                const data = new FormData();
                data.set("file", file);
                data.set("scope", `task-${taskId}`);
                const result = await uploadFormFile(data);
                if (result.ok) setPicked({ key: result.key, filename: result.filename });
                else setProblem(result.error);
              } catch {
                setProblem("That upload didn't go through — try again.");
              } finally {
                setBusy(false);
                event.target.value = "";
              }
            }}
          />
          {busy ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Uploading…
            </span>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{uploadRulesHint(kind)}</p>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}

      <div>
        <Button type="button" size="sm" disabled={!picked || isSaving} onClick={save}>
          {isSaving ? "Uploading…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * One task card in the speaker portal (spec.md §6): what it is, its state,
 * and the way to complete it — reusing the same SchemaForm/upload machinery
 * as a CFP submission.
 *
 * A completed file task keeps its upload control behind a "Replace file"
 * button, lists what earlier uploads it replaced, and carries the comment
 * thread the organizer sees from Admin > Files (decisions.md D-054).
 */
export function TaskItem({
  assignment,
  task,
  state,
  form,
  history,
  comments,
  timeZone,
}: {
  assignment: TaskAssignment;
  task: Task;
  state: TaskState;
  /** The linked form, resolved by the page, for `type: "form"` tasks. */
  form: Form | null;
  /** Current file + everything it replaced, resolved by the page. */
  history: FileHistory;
  comments: CommentView[];
  /** The event's zone: upload and comment stamps are instants. */
  timeZone: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [replacing, setReplacing] = useState(false);
  const done = assignment.status === "completed";
  const isFileTask = task.type === "file_request";

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
            <p className="mt-1 text-xs text-muted-foreground">
              Due {formatDueDate(task.dueAt, timeZone)}
            </p>
          )}
        </div>
        <Badge variant="outline" className={STATE_BADGE_CLASS[state]}>
          {TASK_STATE_LABEL[state]}
        </Badge>
      </div>

      {done && isFileTask && history.current ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <a
            href={history.current.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            View what you uploaded
          </a>
          <span className="truncate text-sm text-muted-foreground">
            {history.current.filename}
          </span>
          {history.versionCount > 1 ? (
            <Badge variant="outline" className="text-muted-foreground">
              Version {history.versionCount}
            </Badge>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setReplacing((open) => !open)}
          >
            {replacing ? "Cancel" : "Replace file"}
          </Button>
        </div>
      ) : null}

      {isFileTask && (!done || replacing) ? (
        <FileUploadControl
          assignmentId={assignment.id}
          taskId={task.id}
          kind={inferUploadKind(task)}
          submitLabel={done ? "Upload new version" : "Upload"}
          onUploaded={() => setReplacing(false)}
        />
      ) : null}

      {isFileTask ? <FileVersionList versions={history.older} timeZone={timeZone} /> : null}

      {done ? null : task.type === "confirm" ? (
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
      ) : isFileTask ? null : (
        <p className="text-sm text-destructive">
          This task needs a form linked to it — ask the organizers to check its setup.
        </p>
      )}

      {/* The thread belongs to the deliverable, so it stays out of the way on
          tasks that never carry one — unless the organizer has already
          started it. */}
      {isFileTask || comments.length > 0 ? (
        <FileCommentThread
          comments={comments}
          timeZone={timeZone}
          action={postTaskComment.bind(null, assignment.id)}
          placeholder="Ask a question or leave a note for the organizers…"
        />
      ) : null}
    </div>
  );
}
