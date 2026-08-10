"use client";

import { useState, useTransition } from "react";
import { PencilIcon, PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
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
import { formatDueDate } from "@/lib/event-time";
import { assignTaskToConfirmedSpeakers, deleteTask } from "./actions";
import { unassignedConfirmedSpeakerIds } from "./coverage";
import { TaskFormDialog } from "./task-form-dialog";
import type { TaskSpeakerOption } from "./types";

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
  speakers,
  assignedSpeakerIdsByTask,
  assignmentCounts,
  confirmedSpeakerCount,
}: {
  eventSlug: string;
  eventTimezone: string;
  tasks: Task[];
  forms: Form[];
  /** This event's roster — who the dialog can aim a task at (D-069). */
  speakers: TaskSpeakerOption[];
  /** Who already holds each task, keyed by task id: the dialog ticks and
   * locks them, since assignment only ever adds. */
  assignedSpeakerIdsByTask: Record<string, string[]>;
  /** Number of speakers currently assigned each task, keyed by task id — just
   * for the delete confirmation copy. */
  assignmentCounts: Record<string, number>;
  /** Every speaker confirmed for this event (decisions.md D-017) — the
   * "Assign to confirmed speakers" (D-052) target and its zero-state. */
  confirmedSpeakerCount: number;
}) {
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [pendingAssign, setPendingAssign] = useState<Task | null>(null);
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

  /** How many confirmed speakers don't already hold this task — the count the
   * confirmation dialog promises and the button's disabled/zero-state. The
   * difference of the two id sets, not of their sizes: an assignment held by
   * an unconfirmed or declined speaker is not coverage of the confirmed
   * roster (see `unassignedConfirmedSpeakerIds`). */
  function missingCount(task: Task) {
    return unassignedConfirmedSpeakerIds(speakers, assignedSpeakerIdsByTask[task.id] ?? []).length;
  }

  function confirmAssign() {
    if (!pendingAssign) return;
    const task = pendingAssign;
    startTransition(async () => {
      const result = await assignTaskToConfirmedSpeakers(eventSlug, task.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPendingAssign(null);
      const { assignedCount } = result.data;
      toast.success(
        assignedCount > 0
          ? `Assigned to ${assignedCount} speaker${assignedCount === 1 ? "" : "s"}`
          : "Everyone confirmed already has this task",
      );
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
          speakers={speakers}
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
                  {task.dueAt ? formatDueDate(task.dueAt, eventTimezone) : "No due date"}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {assignmentCounts[task.id] ?? 0}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Assign "${task.title}" to confirmed speakers`}
                      title={
                        confirmedSpeakerCount === 0
                          ? "No speakers confirmed for this event yet"
                          : missingCount(task) === 0
                            ? "Every confirmed speaker already has this task"
                            : "Assign to confirmed speakers"
                      }
                      disabled={confirmedSpeakerCount === 0 || missingCount(task) === 0}
                      onClick={() => setPendingAssign(task)}
                    >
                      <UserPlusIcon />
                    </Button>
                    <TaskFormDialog
                      eventSlug={eventSlug}
                      eventTimezone={eventTimezone}
                      forms={forms}
                      speakers={speakers}
                      assignedSpeakerIds={assignedSpeakerIdsByTask[task.id] ?? []}
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

      <AlertDialog open={pendingAssign !== null} onOpenChange={(open) => !open && setPendingAssign(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign &quot;{pendingAssign?.title}&quot; to confirmed speakers?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAssign
                ? `This adds the task to ${missingCount(pendingAssign)} speaker${
                    missingCount(pendingAssign) === 1 ? "" : "s"
                  } confirmed for this event who don't already have it. Speakers who already have this task — including any who've finished it — are left untouched.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={confirmAssign}>
              {isPending ? "Assigning…" : "Assign task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
