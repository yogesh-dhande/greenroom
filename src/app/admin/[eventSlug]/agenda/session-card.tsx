"use client";

import { useDraggable } from "@dnd-kit/core";
import { CircleAlertIcon, ClockIcon, GripVerticalIcon } from "lucide-react";
import type { Track } from "@/db/entities";
import {
  CONFLICT_LABEL,
  CONFLICT_SEVERITY,
  worstSeverity,
  type ScheduleConflict,
} from "@/domain/scheduling";
import { formatTime } from "@/components/date-format";
import { cn } from "@/lib/utils";
import type { BoardPerson, BoardSession } from "./types";

export interface SessionCardProps {
  session: BoardSession;
  speakers: BoardPerson[];
  track?: Track;
  conflicts: ScheduleConflict[];
  /** `grid` cards are absolutely positioned inside a room column and size
   * themselves to their duration; `tray` cards are a fixed-height list item. */
  variant: "grid" | "tray";
  draggable: boolean;
  onOpen: (session: BoardSession) => void;
  /** True while this card is the one being dragged (rendered as a shadow). */
  isGhost?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Conflicts get semantic-token treatment only (decisions.md D-018): the two
 * physically-impossible ones shout in `destructive`, programming overlaps sit
 * in `warning`. */
function conflictClasses(conflicts: ScheduleConflict[]): string {
  switch (worstSeverity(conflicts)) {
    case "blocking":
      return "border-destructive bg-destructive/10 ring-1 ring-destructive/40";
    case "advisory":
      return "border-warning bg-warning/10";
    default:
      return "border-border bg-card";
  }
}

export function SessionCard({
  session,
  speakers,
  track,
  conflicts,
  variant,
  draggable,
  onOpen,
  isGhost,
  className,
  style,
}: SessionCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: session.id,
    disabled: !draggable,
    data: { session },
  });

  // dnd-kit marks a disabled draggable `aria-disabled`, but a card a reviewer
  // can't drag is still a button that opens the read-only time dialog — so the
  // drag props only go on when dragging is actually allowed.
  const dragProps = draggable ? { ...attributes, ...listeners } : {};

  const severity = worstSeverity(conflicts);
  const blocking = conflicts.find((c) => CONFLICT_SEVERITY[c.type] === "blocking");
  // A talk accepted and later declined stands its session down as "cancelled"
  // (src/domain/review.ts) — it stays visible so the gap is explained, but
  // reads as stood-down rather than programmed.
  const cancelled = session.status === "cancelled";
  const speakerLine = speakers.map((s) => s.name).join(", ");
  const timeLine =
    session.startTime && session.endTime
      ? `${formatTime(session.startTime)} – ${formatTime(session.endTime)}`
      : "Not scheduled";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...dragProps}
      role="button"
      tabIndex={0}
      aria-label={`${session.title}${cancelled ? " — cancelled" : severity === "blocking" ? " — has a conflict" : ""}`}
      data-session-id={session.id}
      data-conflict={severity ?? "none"}
      onClick={() => onOpen(session)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(session);
        }
      }}
      className={cn(
        "group flex flex-col gap-0.5 overflow-hidden rounded-md border p-2 text-left shadow-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        conflictClasses(conflicts),
        cancelled && "border-dashed opacity-60",
        (isDragging || isGhost) && "opacity-40",
        className,
      )}
    >
      <div className="flex items-start gap-1">
        {track && (
          <span
            aria-hidden
            className="mt-1 size-2 shrink-0 rounded-full bg-muted-foreground"
            style={track.color ? { backgroundColor: track.color } : undefined}
          />
        )}
        <p
          className={cn(
            "line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-tight text-foreground",
            cancelled && "line-through decoration-muted-foreground",
          )}
        >
          {session.title}
        </p>
        {severity && (
          <CircleAlertIcon
            className={cn(
              "mt-0.5 size-3.5 shrink-0",
              severity === "blocking" ? "text-destructive" : "text-warning",
            )}
            aria-hidden
          />
        )}
        {draggable && variant === "tray" && (
          <GripVerticalIcon
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </div>

      {variant === "tray" ? (
        <p className="truncate text-[11px] text-muted-foreground">
          {speakerLine || "No speakers yet"}
        </p>
      ) : (
        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <ClockIcon className="size-3 shrink-0" aria-hidden />
          {timeLine}
          {speakerLine && <span className="truncate">· {speakerLine}</span>}
        </p>
      )}

      {cancelled ? (
        <p className="truncate text-[11px] font-medium text-muted-foreground">Cancelled</p>
      ) : (
        severity && (
          <p
            className={cn(
              "truncate text-[11px] font-medium",
              severity === "blocking" ? "text-destructive" : "text-warning",
            )}
          >
            {CONFLICT_LABEL[(blocking ?? conflicts[0]).type]}
          </p>
        )
      )}
    </div>
  );
}
