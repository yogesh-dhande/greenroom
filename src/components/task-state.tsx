import type { TaskState } from "@/domain/onboarding";
import { cn } from "@/lib/utils";

/**
 * Per-task-state badge styling, shared by every surface that names a task's
 * state in words — the speaker roster and a speaker's record both read this
 * one map rather than keeping a copy each. `warning` is the shared semantic
 * token for anything due soon (decisions.md D-018) — never a raw amber class.
 */
export const TASK_STATE_BADGE_CLASS: Record<TaskState, string> = {
  complete: "border-border text-muted-foreground",
  open: "border-border text-foreground",
  due_soon: "border-warning bg-warning/10 text-warning",
  overdue: "border-destructive bg-destructive/10 text-destructive",
};

/**
 * The same four states as a filled square, for the roster's task strip. The
 * hues match the badges above so a square and a badge for the same state are
 * recognizably the same thing: primary for done, a quiet muted fill for what
 * is merely open, `warning` for due soon and `destructive` for overdue.
 */
export const TASK_STATE_SQUARE_CLASS: Record<TaskState, string> = {
  complete: "bg-primary",
  open: "bg-muted-foreground/35",
  due_soon: "bg-warning",
  overdue: "bg-destructive",
};

export interface TaskStateStripItem {
  /** Stable react key — the assignment id at every call site. */
  key: string;
  state: TaskState;
  /** The square's tooltip and accessible name: task title and state. */
  title: string;
}

export interface TaskStateStripProps {
  items: TaskStateStripItem[];
  /** What a speaker with no assignments shows in place of the strip. */
  emptyLabel?: string;
  className?: string;
}

/**
 * One small square per assignment, colored by state — a speaker's whole task
 * load in the width of a few characters.
 *
 * This replaces a row of full task-title pills, which wrapped a roster row to
 * two or three lines each and made the table unscannable. The titles aren't
 * lost: each square keeps the pill's tooltip (title, state, due date), so
 * hovering still answers "which task is that?" without opening the record.
 * Every square is also its own labelled graphic, so the information survives
 * for a keyboard or screen-reader user who never sees the colors.
 */
export function TaskStateStrip({ items, emptyLabel = "—", className }: TaskStateStripProps) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 align-middle", className)}>
      {items.map((item) => (
        <span
          key={item.key}
          role="img"
          aria-label={item.title}
          title={item.title}
          className={cn("size-2.5 shrink-0 rounded-[3px]", TASK_STATE_SQUARE_CLASS[item.state])}
        />
      ))}
    </span>
  );
}
