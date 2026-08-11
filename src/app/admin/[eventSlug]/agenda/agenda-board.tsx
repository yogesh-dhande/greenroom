"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { CircleAlertIcon, CircleCheckIcon, InboxIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { Room, Track } from "@/db/entities";
import {
  CONFLICT_LABEL,
  CONFLICT_SEVERITY,
  DEFAULT_SESSION_MINUTES,
  MINUTES_PER_DAY,
  conflictsBySession,
  detectConflicts,
  minutesOfDay,
  snapToGrid,
  timeOfMinutes,
  type ScheduleConflict,
} from "@/domain/scheduling";
import {
  ANY_CONTENT_STATUS,
  CONTENT_STATUS_LABEL,
  SESSION_CONTENT_STATUSES,
  filterByContentStatus,
} from "@/domain/session-content";
import { formatDay, formatTime } from "@/components/date-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  deleteSession,
  placeSession,
  restoreAbstractRevision,
  unscheduleSession,
  updateSessionContent,
  updateSessionSpeakers,
  type PlacementInput,
  type SessionContentInput,
} from "./actions";
import {
  NO_ROOM_COLUMN,
  PX_PER_MINUTE,
  SLOT_HEIGHT,
  TRAY_DROPPABLE_ID,
  assignLanes,
  cardGeometry,
  hourMarks,
  parseSlotId,
  sessionMinutes,
  slotId,
  slotMinutes,
  timeWindowFor,
} from "./board-layout";
import { NewSessionDialog } from "./new-session-dialog";
import { SessionCard } from "./session-card";
import { SessionEditDialog } from "./session-edit-dialog";
import type { BoardPerson, BoardSession, SessionRevisionView } from "./types";

interface SessionPatch {
  id: string;
  changes: Partial<BoardSession>;
}

/** True once a session has everything the grid needs to draw it. */
function isPlaced(session: BoardSession): boolean {
  return Boolean(session.day && session.startTime && session.endTime);
}

export function AgendaBoard({
  eventSlug,
  days,
  rooms,
  tracks,
  sessions,
  people,
  directory,
  roster,
  revisions,
  canEdit,
  focusSessionId,
}: {
  eventSlug: string;
  days: string[];
  rooms: Room[];
  tracks: Track[];
  sessions: BoardSession[];
  /** Every person on a session, by user id. */
  people: Record<string, BoardPerson>;
  /** Everyone who can be added to a directly-entered session. */
  directory: BoardPerson[];
  /** This event's speaker roster — who the edit dialog can add (D-057). */
  roster: BoardPerson[];
  /** Abstract history per session id, newest first (decisions.md D-071). */
  revisions: Record<string, SessionRevisionView[]>;
  canEdit: boolean;
  /** Opens straight into this session's edit dialog on load — the submission
   * detail page's "Edit title, abstract & track" deep link (D-054(5)). */
  focusSessionId?: string;
}) {
  const [optimisticSessions, applyPatch] = useOptimistic(
    sessions,
    (state: BoardSession[], patch: SessionPatch) =>
      state.map((s) => (s.id === patch.id ? { ...s, ...patch.changes } : s)),
  );
  const [, startTransition] = useTransition();

  const focusSession = focusSessionId
    ? (sessions.find((s) => s.id === focusSessionId) ?? null)
    : null;
  const firstProgrammedDay = sessions.find((s) => s.day)?.day;
  const [selectedDay, setSelectedDay] = useState(() => {
    if (focusSession?.day && days.includes(focusSession.day)) return focusSession.day;
    return firstProgrammedDay && days.includes(firstProgrammedDay) ? firstProgrammedDay : days[0];
  });
  const [editing, setEditing] = useState<BoardSession | null>(focusSession);
  /**
   * Approval filter (decisions.md D-072). Presentation only: conflicts below
   * are still computed from every session, because a talk held back for a
   * rewrite still occupies its room and its speaker.
   */
  const [contentFilter, setContentFilter] = useState<string>(ANY_CONTENT_STATUS);
  const [dragging, setDragging] = useState<BoardSession | null>(null);
  /** How far below the card's top edge the pointer grabbed it, in minutes —
   * so a card dropped by its middle doesn't jump forward by half its length. */
  const grabOffsetRef = useRef(0);

  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  // Conflicts are recomputed from the optimistic board on every render, so the
  // warning appears in the same frame as the placement (spec.md §9).
  const conflicts = useMemo(() => detectConflicts(optimisticSessions), [optimisticSessions]);
  const conflictsFor = useMemo(() => conflictsBySession(conflicts), [conflicts]);
  const sessionById = useMemo(
    () => new Map(optimisticSessions.map((s) => [s.id, s])),
    [optimisticSessions],
  );

  /** What the board draws: every session unless the organizer narrowed by
   * approval status. */
  const shownSessions = useMemo(
    () => filterByContentStatus(optimisticSessions, contentFilter),
    [optimisticSessions, contentFilter],
  );
  const contentStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of optimisticSessions) {
      counts.set(session.contentStatus, (counts.get(session.contentStatus) ?? 0) + 1);
    }
    return counts;
  }, [optimisticSessions]);

  const placedByDay = useMemo(() => {
    const byDay = new Map<string, BoardSession[]>();
    for (const session of shownSessions) {
      if (!isPlaced(session) || !session.day) continue;
      byDay.set(session.day, [...(byDay.get(session.day) ?? []), session]);
    }
    return byDay;
  }, [shownSessions]);

  const daySessions = useMemo(
    () => placedByDay.get(selectedDay) ?? [],
    [placedByDay, selectedDay],
  );
  const unscheduled = shownSessions.filter((s) => !isPlaced(s));
  const timeWindow = useMemo(() => timeWindowFor(daySessions), [daySessions]);
  const gridHeight = (timeWindow.endMinute - timeWindow.startMinute) * PX_PER_MINUTE;
  const slots = useMemo(() => slotMinutes(timeWindow), [timeWindow]);
  const hours = useMemo(() => hourMarks(timeWindow), [timeWindow]);

  /** The hours "Suggest a slot" (decisions.md D-067) may propose: the working
   * day, widened across every day so a suggestion can use a late or early hour
   * the event already programs somewhere. */
  const suggestionWindow = useMemo(
    () => timeWindowFor(optimisticSessions.filter(isPlaced)),
    [optimisticSessions],
  );

  /** Room columns, plus a holding column when something is on the day without
   * a room (possible via the time dialog). */
  const columns = useMemo(() => {
    const roomIds = new Set(rooms.map((r) => r.id));
    const needsNoRoom = daySessions.some((s) => !s.roomId || !roomIds.has(s.roomId));
    const cols: Array<{ id: string; name: string; capacity: number | null }> = rooms.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
    }));
    if (needsNoRoom || rooms.length === 0) {
      cols.push({ id: NO_ROOM_COLUMN, name: "No room yet", capacity: null });
    }
    return cols;
  }, [rooms, daySessions]);

  const speakersOf = (session: BoardSession): BoardPerson[] =>
    session.speakerIds.flatMap((id) => (people[id] ? [people[id]] : []));

  // --- writes --------------------------------------------------------------

  function place(session: BoardSession, placement: PlacementInput) {
    startTransition(async () => {
      applyPatch({ id: session.id, changes: placement });
      const result = await placeSession(eventSlug, session.id, placement);
      if (!result.ok) toast.error(result.error);
      else toast.success("Session time saved");
    });
  }

  function saveContent(session: BoardSession, content: SessionContentInput) {
    startTransition(async () => {
      applyPatch({
        id: session.id,
        changes: {
          title: content.title,
          description: content.description ?? null,
          trackId: content.trackId ?? null,
          ...(content.contentStatus ? { contentStatus: content.contentStatus } : {}),
        },
      });
      const result = await updateSessionContent(eventSlug, session.id, content);
      if (!result.ok) toast.error(result.error);
      else toast.success("Session details saved");
    });
  }

  // Restoring an earlier abstract (decisions.md D-071). No optimistic patch:
  // the text being restored lives on the server side of the history entry, so
  // the board waits for the write rather than guessing at it.
  function restoreRevision(session: BoardSession, revisionId: string) {
    startTransition(async () => {
      const result = await restoreAbstractRevision(eventSlug, revisionId);
      if (!result.ok) toast.error(result.error);
      else toast.success(`Earlier abstract restored on "${session.title}"`);
    });
  }

  function updateSpeakers(session: BoardSession, speakerIds: string[]) {
    startTransition(async () => {
      applyPatch({ id: session.id, changes: { speakerIds } });
      const result = await updateSessionSpeakers(eventSlug, session.id, { speakerIds });
      if (!result.ok) toast.error(result.error);
    });
  }

  function unschedule(session: BoardSession) {
    startTransition(async () => {
      applyPatch({
        id: session.id,
        changes: { day: null, startTime: null, endTime: null, roomId: null },
      });
      const result = await unscheduleSession(eventSlug, session.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(`"${session.title}" moved back to unscheduled`);
    });
  }

  function remove(session: BoardSession) {
    startTransition(async () => {
      const result = await deleteSession(eventSlug, session.id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Session deleted");
    });
  }

  // --- drag ----------------------------------------------------------------

  const sensors = useSensors(
    // A small threshold keeps a plain click on a card opening the time dialog.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const session = event.active.data.current?.session as BoardSession | undefined;
    setDragging(session ?? null);
    grabOffsetRef.current = 0;
    if (!session || !isPlaced(session)) return;

    const rect = event.active.rect.current.initial;
    const pointer = event.activatorEvent as Partial<PointerEvent> | undefined;
    if (rect && typeof pointer?.clientY === "number") {
      grabOffsetRef.current = snapToGrid(Math.max(0, (pointer.clientY - rect.top) / PX_PER_MINUTE));
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const session = event.active.data.current?.session as BoardSession | undefined;
    setDragging(null);
    if (!session || !event.over) return;

    if (event.over.id === TRAY_DROPPABLE_ID) {
      if (isPlaced(session)) unschedule(session);
      return;
    }

    const slot = parseSlotId(String(event.over.id));
    if (!slot) return;

    const duration = sessionMinutes(session, DEFAULT_SESSION_MINUTES);
    const start = Math.max(
      timeWindow.startMinute,
      Math.min(snapToGrid(slot.minute - grabOffsetRef.current), MINUTES_PER_DAY - duration),
    );
    place(session, {
      day: selectedDay,
      roomId: slot.roomId,
      startTime: timeOfMinutes(start),
      endTime: timeOfMinutes(start + duration),
    });
  }

  // --- conflict summary ----------------------------------------------------

  const blockingCount = conflicts.filter((c) => CONFLICT_SEVERITY[c.type] === "blocking").length;
  const dayOfConflict = (conflict: ScheduleConflict) =>
    sessionById.get(conflict.sessionIds[0])?.day ?? selectedDay;

  return (
    <DndContext
      // Stable id: dnd-kit otherwise generates the aria-describedby ids from a
      // module-level counter, which differs between the server render and the
      // client and trips React's hydration attribute check.
      id="agenda-board"
      sensors={sensors}
      collisionDetection={pointerWithin}
      modifiers={[restrictToWindowEdges]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex flex-col gap-3">
        {/* Day switcher + conflict summary */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1">
            {days.map((day) => {
              const count = placedByDay.get(day)?.length ?? 0;
              const dayHasConflict = conflicts.some(
                (c) =>
                  CONFLICT_SEVERITY[c.type] === "blocking" &&
                  c.sessionIds.some((id) => sessionById.get(id)?.day === day),
              );
              return (
                <Button
                  key={day}
                  size="sm"
                  variant={day === selectedDay ? "secondary" : "ghost"}
                  aria-pressed={day === selectedDay}
                  onClick={() => setSelectedDay(day)}
                >
                  {formatDay(day)}
                  <span className="text-xs text-muted-foreground">{count}</span>
                  {dayHasConflict && (
                    <CircleAlertIcon className="size-3.5 text-destructive" aria-hidden />
                  )}
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Approval filter (decisions.md D-072) — a dropdown rather than
                chips so it sits in the toolbar without competing with the day
                switcher for width. */}
            <Select value={contentFilter} onValueChange={setContentFilter}>
              <SelectTrigger size="sm" className="w-48" aria-label="Filter by content status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_CONTENT_STATUS}>
                  All content ({optimisticSessions.length})
                </SelectItem>
                {SESSION_CONTENT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {CONTENT_STATUS_LABEL[value]} ({contentStatusCounts.get(value) ?? 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {conflicts.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CircleCheckIcon className="size-4" aria-hidden />
                No scheduling conflicts
              </p>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant={blockingCount > 0 ? "destructive" : "outline"}
                    className={blockingCount > 0 ? undefined : "border-warning text-warning"}
                    data-testid="conflict-summary"
                  >
                    <CircleAlertIcon />
                    {blockingCount > 0
                      ? `${blockingCount} conflict${blockingCount === 1 ? "" : "s"}`
                      : `${conflicts.length} overlap${conflicts.length === 1 ? "" : "s"}`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96">
                  <p className="mb-2 text-sm font-medium text-foreground">Scheduling conflicts</p>
                  <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                    {conflicts.map((conflict, index) => (
                      <li
                        key={`${conflict.type}-${conflict.sessionIds.join("-")}-${index}`}
                        className="flex flex-col gap-1 rounded-md border border-border p-2"
                      >
                        <Badge
                          variant={
                            CONFLICT_SEVERITY[conflict.type] === "blocking"
                              ? "destructive"
                              : "outline"
                          }
                          className={
                            CONFLICT_SEVERITY[conflict.type] === "blocking"
                              ? undefined
                              : "border-warning text-warning"
                          }
                        >
                          {CONFLICT_LABEL[conflict.type]}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{conflict.message}</p>
                        <button
                          type="button"
                          className="self-start text-xs font-medium text-foreground underline-offset-4 hover:underline"
                          onClick={() => setSelectedDay(dayOfConflict(conflict))}
                        >
                          Show on {formatDay(dayOfConflict(conflict))}
                        </button>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        {/* Unscheduled tray — a full-width strip above the grid so every room
            column below gets equal, uncramped width (W25 5B). */}
        <Tray
          sessions={unscheduled}
          trackById={trackById}
          conflictsFor={conflictsFor}
          speakersOf={speakersOf}
          canEdit={canEdit}
          onOpen={setEditing}
          eventSlug={eventSlug}
          tracks={tracks}
          directory={directory}
          dragging={dragging}
        />

        {/* The grid */}
        <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card">
          <div
            className="grid"
            style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {/* Time gutter */}
            <div className="border-r border-border">
              <div className="h-9 border-b border-border" />
              <div className="relative" style={{ height: gridHeight }}>
                {hours.map((minute) => (
                  <span
                    key={minute}
                    className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
                    style={{ top: (minute - timeWindow.startMinute) * PX_PER_MINUTE }}
                  >
                    {formatTime(timeOfMinutes(minute))}
                  </span>
                ))}
              </div>
            </div>

            {columns.map((column) => {
              const columnSessions = daySessions.filter((s) =>
                column.id === NO_ROOM_COLUMN
                  ? !s.roomId || !rooms.some((r) => r.id === s.roomId)
                  : s.roomId === column.id,
              );
              const laid = assignLanes(
                columnSessions.map((session) => ({
                  session,
                  startMinute: minutesOfDay(session.startTime as string),
                  endMinute: minutesOfDay(session.endTime as string),
                })),
              );

              return (
                <div key={column.id} className="min-w-0 border-r border-border last:border-r-0">
                  <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-2">
                    <span className="truncate text-xs font-medium text-foreground">
                      {column.name}
                    </span>
                    {column.capacity != null && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {column.capacity}
                      </span>
                    )}
                  </div>

                  <div className="relative" style={{ height: gridHeight }}>
                    {slots.map((minute) => (
                      <Slot
                        key={minute}
                        id={slotId(column.id, minute)}
                        label={`${column.name} at ${formatTime(timeOfMinutes(minute))}`}
                        minute={minute}
                        top={(minute - timeWindow.startMinute) * PX_PER_MINUTE}
                        disabled={!canEdit}
                      />
                    ))}

                    {laid.map(({ session, startMinute, endMinute, lane, lanes }) => {
                      const { top, height } = cardGeometry({ startMinute, endMinute }, timeWindow);
                      return (
                        <SessionCard
                          key={session.id}
                          session={session}
                          speakers={speakersOf(session)}
                          track={session.trackId ? trackById.get(session.trackId) : undefined}
                          conflicts={conflictsFor.get(session.id) ?? []}
                          variant="grid"
                          draggable={canEdit}
                          onOpen={setEditing}
                          isGhost={dragging?.id === session.id}
                          className="absolute"
                          style={{
                            top,
                            height,
                            left: `calc(${(lane / lanes) * 100}% + 2px)`,
                            width: `calc(${100 / lanes}% - 4px)`,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {rooms.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This event has no rooms yet.{" "}
            <Link
              href={`/admin/${eventSlug}/settings`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Add rooms in settings
            </Link>{" "}
            to schedule by room.
          </p>
        )}
      </div>

      <SessionEditDialog
        eventSlug={eventSlug}
        session={editing}
        days={days}
        rooms={rooms}
        tracks={tracks}
        sessions={optimisticSessions}
        suggestionWindow={suggestionWindow}
        people={people}
        roster={roster}
        revisions={revisions}
        defaultDay={selectedDay}
        canEdit={canEdit}
        onOpenChange={(open) => !open && setEditing(null)}
        onPlace={place}
        onSaveContent={saveContent}
        onRestoreRevision={restoreRevision}
        onUpdateSpeakers={updateSpeakers}
        onUnschedule={unschedule}
        onDelete={remove}
      />

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <SessionCard
            session={dragging}
            speakers={speakersOf(dragging)}
            track={dragging.trackId ? trackById.get(dragging.trackId) : undefined}
            conflicts={[]}
            variant="tray"
            draggable={false}
            onOpen={() => {}}
            className="w-52 cursor-grabbing shadow-lg"
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** One 15-minute drop target. Hour and half-hour lines are drawn here so the
 * grid and the drop zones can never disagree. */
function Slot({
  id,
  label,
  minute,
  top,
  disabled,
}: {
  id: string;
  label: string;
  minute: number;
  top: number;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      data-slot-id={id}
      aria-label={label}
      style={{ top, height: SLOT_HEIGHT }}
      className={cn(
        "absolute inset-x-0",
        minute % 60 === 0 ? "border-t border-border" : "border-t border-border/40",
        isOver && "bg-accent",
      )}
    />
  );
}

function Tray({
  sessions,
  trackById,
  conflictsFor,
  speakersOf,
  canEdit,
  onOpen,
  eventSlug,
  tracks,
  directory,
  dragging,
}: {
  sessions: BoardSession[];
  trackById: Map<string, Track>;
  conflictsFor: Map<string, ScheduleConflict[]>;
  speakersOf: (session: BoardSession) => BoardPerson[];
  canEdit: boolean;
  onOpen: (session: BoardSession) => void;
  eventSlug: string;
  tracks: Track[];
  directory: BoardPerson[];
  dragging: BoardSession | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY_DROPPABLE_ID, disabled: !canEdit });

  return (
    <div
      ref={setNodeRef}
      data-testid="unscheduled-tray"
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors",
        isOver && "border-primary bg-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <InboxIcon className="size-4 text-muted-foreground" aria-hidden />
          Unscheduled
          <span className="text-muted-foreground">{sessions.length}</span>
        </p>
        {canEdit && (
          <NewSessionDialog eventSlug={eventSlug} tracks={tracks} directory={directory} />
        )}
      </div>

      {/* Cards lay out left to right and wrap; the dashed zone is the whole
          tray's drop target (see useDroppable above) made visible, and fills
          whatever width the cards don't use. */}
      <div className="flex max-h-48 flex-wrap items-stretch gap-2 overflow-y-auto">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            speakers={speakersOf(session)}
            track={session.trackId ? trackById.get(session.trackId) : undefined}
            conflicts={conflictsFor.get(session.id) ?? []}
            variant="tray"
            draggable={canEdit}
            onOpen={onOpen}
            isGhost={dragging?.id === session.id}
            className="w-52 shrink-0"
          />
        ))}
        <div
          className={cn(
            "flex min-w-40 flex-1 items-center justify-center rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground transition-colors",
            isOver && "border-primary text-foreground",
          )}
        >
          {sessions.length === 0
            ? "Everything is programmed. Drag a session here to take it off the schedule."
            : "Drop here to unschedule"}
        </div>
      </div>
    </div>
  );
}
