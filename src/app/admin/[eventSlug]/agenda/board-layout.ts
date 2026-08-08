/**
 * Geometry for the agenda board (spec.md §9). Pure functions — the vertical
 * axis is minutes, the horizontal axis is rooms, and everything the grid draws
 * is derived here so the React components stay about interaction.
 */
import type { Session } from "@/db/entities";
import { SNAP_MINUTES, durationMinutes, minutesOfDay } from "@/domain/scheduling";

/** Vertical scale: one 15-minute slot is 24px tall, an hour 96px. */
export const PX_PER_MINUTE = 1.6;
export const SLOT_HEIGHT = SNAP_MINUTES * PX_PER_MINUTE;

/** The day the board shows when the event has no dates of its own. */
export const DEFAULT_WINDOW_START = 8 * 60;
export const DEFAULT_WINDOW_END = 20 * 60;

/** Column id used for sessions placed on a day but not yet in a room. */
export const NO_ROOM_COLUMN = "__no_room__";

export interface TimeWindow {
  startMinute: number;
  endMinute: number;
}

/** The visible time range: the default working day, widened to contain
 * whatever is already programmed so nothing can hide off-grid. */
export function timeWindowFor(sessions: Session[]): TimeWindow {
  let start = DEFAULT_WINDOW_START;
  let end = DEFAULT_WINDOW_END;
  for (const session of sessions) {
    if (!session.startTime || !session.endTime) continue;
    start = Math.min(start, Math.floor(minutesOfDay(session.startTime) / 60) * 60);
    end = Math.max(end, Math.ceil(minutesOfDay(session.endTime) / 60) * 60);
  }
  return { startMinute: start, endMinute: Math.min(end, 24 * 60) };
}

/** Every snap position in the window — one droppable slot each. */
export function slotMinutes(window: TimeWindow): number[] {
  const slots: number[] = [];
  for (let m = window.startMinute; m < window.endMinute; m += SNAP_MINUTES) slots.push(m);
  return slots;
}

/** Whole hours in the window, for the left-hand gutter labels. */
export function hourMarks(window: TimeWindow): number[] {
  const hours: number[] = [];
  for (let m = Math.ceil(window.startMinute / 60) * 60; m < window.endMinute; m += 60) {
    hours.push(m);
  }
  return hours;
}

// ---------------------------------------------------------------------------
// Overlap lanes — two sessions in one room at one time is a conflict, not an
// error, so the column splits and shows both side by side.
// ---------------------------------------------------------------------------

export interface LaneAssignment {
  /** 0-based horizontal position inside the room column. */
  lane: number;
  /** How many lanes the overlapping cluster needs. */
  lanes: number;
}

interface Span {
  startMinute: number;
  endMinute: number;
}

export function assignLanes<T extends Span>(items: T[]): Array<T & LaneAssignment> {
  const sorted = [...items].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
  const result: Array<T & LaneAssignment> = [];

  let clusterStart = 0;
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const closeCluster = (upto: number) => {
    for (let i = clusterStart; i < upto; i += 1) result[i].lanes = laneEnds.length || 1;
    laneEnds = [];
  };

  sorted.forEach((item, index) => {
    if (item.startMinute >= clusterEnd) {
      closeCluster(index);
      clusterStart = index;
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinute);
    } else {
      laneEnds[lane] = item.endMinute;
    }
    clusterEnd = Math.max(clusterEnd, item.endMinute);
    result.push({ ...item, lane, lanes: 1 });
  });
  closeCluster(result.length);

  return result;
}

/** Pixel offset/height of a placed session inside the grid. */
export function cardGeometry(span: Span, window: TimeWindow) {
  const top = (span.startMinute - window.startMinute) * PX_PER_MINUTE;
  const height = Math.max(
    (span.endMinute - span.startMinute) * PX_PER_MINUTE,
    SLOT_HEIGHT - 2,
  );
  return { top, height };
}

/** Session length, defaulting for rows that have no end time yet. */
export function sessionMinutes(session: Session, fallback: number): number {
  if (!session.startTime || !session.endTime) return fallback;
  const minutes = durationMinutes(session.startTime, session.endTime);
  return minutes > 0 ? minutes : fallback;
}

// ---------------------------------------------------------------------------
// Droppable ids. Encoded as strings because that's what dnd-kit compares.
// ---------------------------------------------------------------------------

export const TRAY_DROPPABLE_ID = "agenda-tray";

export function slotId(roomId: string, minute: number): string {
  return `slot|${roomId}|${minute}`;
}

export function parseSlotId(id: string): { roomId: string | null; minute: number } | null {
  const parts = id.split("|");
  if (parts.length !== 3 || parts[0] !== "slot") return null;
  const minute = Number(parts[2]);
  if (!Number.isFinite(minute)) return null;
  return { roomId: parts[1] === NO_ROOM_COLUMN ? null : parts[1], minute };
}
