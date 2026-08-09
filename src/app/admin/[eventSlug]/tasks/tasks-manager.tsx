"use client";

import { useState, useTransition } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Form, Task } from "@/db/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { formatDate } from "@/components/date-format";
import { deleteTask } from "./actions";
import { TaskFormDialog } from "./task-form-dialog";

const TASK_TYPE_LABEL: Record<string, string> = {
  form: "Fill out a form",
  file_request: "Upload a file",
  confirm: "Confirm information",
};

export function TasksManager({
  eventSlug,
  eventTimezone,
  tasks,
  forms,
  assignmentCounts,
}: {
  eventSlug: string;
  eventTimezone: string;
  tasks: Task[];
  forms: Form[];
  /** Number of speakers currently assigned each task, keyed by task id — just
   * for the delete confirmation copy. */
  assignmentCounts: Record<string, number>;
}) {
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    if (!pendingDelete) return;
    const task = pendingDelete;
    startTransition(async () => {
      const result = await deleteTask(eventSlug, task.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Task deleted");
        setPendingDelete(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Auto-assigned tasks land on a speaker&apos;s portal the moment their talk is accepted.
        </p>
        <TaskFormDialog
          eventSlug={eventSlug}
          eventTimezone={eventTimezone}
          forms={forms}
          trigger={
            <Button size="sm" variant="outline">
              <PlusIcon />
              New task
            </Button>
          }
        />
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description="Define onboarding tasks and they can auto-assign to speakers when a submission is accepted."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium text-foreground">{task.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{TASK_TYPE_LABEL[task.type] ?? task.type}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {task.dueAt ? formatDate(task.dueAt) : "No due date"}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {assignmentCounts[task.id] ?? 0}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <TaskFormDialog
                      eventSlug={eventSlug}
                      eventTimezone={eventTimezone}
                      forms={forms}
                      task={task}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${task.title}`}>
                          <PencilIcon />
                        </Button>
                      }
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${task.title}`}
                      onClick={() => setPendingDelete(task)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{pendingDelete?.title}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (assignmentCounts[pendingDelete.id] ?? 0) > 0
                ? `This removes it from ${assignmentCounts[pendingDelete.id]} speaker${
                    assignmentCounts[pendingDelete.id] === 1 ? "" : "s"
                  }' portals, including any work they've already submitted. This can't be undone.`
                : "This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={confirmDelete}>
              {isPending ? "Deleting…" : "Delete task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
