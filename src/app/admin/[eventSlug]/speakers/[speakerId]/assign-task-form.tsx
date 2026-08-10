"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PickerSearch } from "@/components/people-picker/people-picker";
import { filterByQuery, isLongList } from "@/components/people-picker/selection";
import { assignTaskToSpeaker } from "../actions";

/** One of the event's tasks, as offered on a speaker's record. */
export interface AssignableTask {
  id: string;
  title: string;
  /** Already on this speaker's checklist — offered, but labelled, so
   * re-assigning is an informed no-op rather than a mystery. */
  assigned: boolean;
}

/**
 * "Assign a task" on a speaker's record (decisions.md D-052, shipped by
 * D-069): pick one of the event's tasks and hand it to this speaker, without
 * going via the task list and without touching everyone else.
 *
 * Tasks the speaker already holds stay in the list, marked. Assigning one
 * again is safe by construction — the server plans the write through the
 * same dedupe the all-at-once action uses, so a duplicate is never created
 * and finished work is never reset — and hiding them would leave an
 * organizer wondering where the task went.
 *
 * One task is one choice, so the control stays a select; an event with a long
 * checklist gets the same search box the recipient pickers use over its
 * options, on the shared threshold.
 */
export function AssignTaskForm({
  eventSlug,
  speakerId,
  tasks,
}: {
  eventSlug: string;
  speakerId: string;
  tasks: AssignableTask[];
}) {
  const [taskId, setTaskId] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const searchable = isLongList(tasks.length);
  const shown = useMemo(() => {
    if (!searchable) return tasks;
    const matched = filterByQuery(tasks, query, (task) => [task.title]);
    // The chosen task never vanishes from under the choice — a select whose
    // value has no option renders an empty trigger over a live selection.
    const chosen = tasks.find((task) => task.id === taskId);
    return chosen && !matched.some((task) => task.id === taskId)
      ? [chosen, ...matched]
      : matched;
  }, [tasks, query, searchable, taskId]);

  function assign() {
    if (!taskId) return;
    setError(null);
    startTransition(async () => {
      const result = await assignTaskToSpeaker(eventSlug, { speakerId, taskId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.assigned) {
        toast.success(result.data.message);
      } else {
        toast.info(result.data.message);
      }
      setTaskId("");
    });
  }

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This event has no tasks yet. Create one on the Tasks page and it can be assigned from
        here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-task">Task</Label>
        {searchable ? (
          <PickerSearch
            value={query}
            onValueChange={setQuery}
            label="Search tasks"
            placeholder="Task title"
          />
        ) : null}
        <Select value={taskId} onValueChange={setTaskId}>
          <SelectTrigger id="assign-task" className="w-full">
            <SelectValue placeholder="Choose a task…" />
          </SelectTrigger>
          <SelectContent>
            {shown.map((task) => (
              <SelectItem key={task.id} value={task.id}>
                {task.title}
                {task.assigned ? " · already assigned" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {searchable && query.trim() ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Showing {shown.length} of {tasks.length} tasks
          </p>
        ) : null}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" size="sm" disabled={isPending || !taskId} onClick={assign}>
        {isPending ? "Assigning…" : "Assign task"}
      </Button>
    </div>
  );
}
