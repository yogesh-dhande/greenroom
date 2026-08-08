/**
 * Scheduling domain service — agenda conflict detection (spec.md §9). Pure
 * TypeScript: no datastore imports. Callers fetch Session rows via
 * src/db/repos/* and pass plain entities in.
 *
 * Sessions carry a calendar `day` ("YYYY-MM-DD") plus wall-clock
 * `startTime`/`endTime` ("HH:MM") in the event's own timezone, so overlap
 * is pure arithmetic on minutes — no timezone conversion, and no chance of
 * a session drifting a day when the reader is elsewhere.
 */
import type { Session } from "@/db/entities";

export type ConflictType = "speaker_double_booked" | "room_double_booked" | "track_overlap";

export interface ScheduleConflict {
  type: ConflictType;
  sessionIds: [string, string];
  message: string;
}

export interface SessionWithSpeakers extends Session {
  speakerIds: string[];
}

/** The grid the agenda builder snaps drag-and-drop placements to. */
export const SNAP_MINUTES = 15;

/** Length given to a session that gets placed without one (spec.md §9). */
export const DEFAULT_SESSION_MINUTES = 30;

/** Minutes in a day, and the last wall-clock minute a session may start at. */
export const MINUTES_PER_DAY = 24 * 60;

/** "HH:MM" -> minutes since midnight. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight -> "HH:MM", clamped inside the day. */
export function timeOfMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  return `${String(hours).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Rounds minutes to the placement grid. */
export function snapToGrid(minutes: number, snap: number = SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap;
}

/** Length of a placed session in minutes (end after start on the same day). */
export function durationMinutes(startTime: string, endTime: string): number {
  return minutesOfDay(endTime) - minutesOfDay(startTime);
}

/** Every "YYYY-MM-DD" from `start` to `end` inclusive — the agenda's day tabs.
 * Returns [] when either bound is missing, and [start] when end precedes it. */
export function enumerateDays(start: string | null, end: string | null): string[] {
  if (!start) return end ? [end] : [];
  if (!end || end < start) return [start];
  const days: string[] = [];
  // Iterate in UTC: `day` strings are timezone-free calendar dates, so UTC
  // arithmetic can't shift one across a DST boundary.
  for (
    let cursor = new Date(`${start}T00:00:00Z`);
    cursor <= new Date(`${end}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    days.push(cursor.toISOString().slice(0, 10));
    // Guard against a pathological range locking the UI up.
    if (days.length > 366) break;
  }
  return days;
}

/** True if two [start, end) wall-clock ranges on the same day overlap. */
export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return minutesOfDay(aStart) < minutesOfDay(bEnd) && minutesOfDay(bStart) < minutesOfDay(aEnd);
}

interface PlacedSession extends SessionWithSpeakers {
  day: string;
  startTime: string;
  endTime: string;
}

/** Narrows to sessions actually placed on the agenda (spec.md §9: unplaced
 * sessions sit in the parking lot and can't conflict with anything). */
function isPlaced(session: SessionWithSpeakers): session is PlacedSession {
  return Boolean(session.day && session.startTime && session.endTime);
}

/**
 * Detects the conflicts spec.md §9 calls out: the same speaker double-booked,
 * the same room double-booked, and overlapping sessions within one track.
 * Run on every drag-and-drop placement — O(n²) is free at conference scale
 * (a few hundred sessions).
 */
export function detectConflicts(sessions: SessionWithSpeakers[]): ScheduleConflict[] {
  const placed = sessions.filter(isPlaced).filter((s) => s.status !== "cancelled");
  const conflicts: ScheduleConflict[] = [];

  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (a.day !== b.day) continue;
      if (!timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;

      const ids: [string, string] = [a.id, b.id];

      if (a.roomId && a.roomId === b.roomId) {
        conflicts.push({
          type: "room_double_booked",
          sessionIds: ids,
          message: `"${a.title}" and "${b.title}" are in the same room at the same time.`,
        });
      }

      const sharedSpeakers = a.speakerIds.filter((id) => b.speakerIds.includes(id));
      if (sharedSpeakers.length > 0) {
        conflicts.push({
          type: "speaker_double_booked",
          sessionIds: ids,
          message: `A speaker is on both "${a.title}" and "${b.title}" at the same time.`,
        });
      }

      if (a.trackId && a.trackId === b.trackId) {
        conflicts.push({
          type: "track_overlap",
          sessionIds: ids,
          message: `"${a.title}" and "${b.title}" overlap within the same track.`,
        });
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Presenting conflicts (spec.md §9: conflicts never block a placement, but
// they must be impossible to miss)
// ---------------------------------------------------------------------------

/**
 * `blocking` conflicts are the two the spec names — one room or one person
 * cannot physically be in two places. `advisory` ones are programming
 * judgement calls an organizer may well accept (two talks from one track
 * running opposite each other), so they are reported without shouting.
 */
export type ConflictSeverity = "blocking" | "advisory";

export const CONFLICT_SEVERITY: Record<ConflictType, ConflictSeverity> = {
  speaker_double_booked: "blocking",
  room_double_booked: "blocking",
  track_overlap: "advisory",
};

/** Short human labels — organizer vocabulary, not enum names. */
export const CONFLICT_LABEL: Record<ConflictType, string> = {
  speaker_double_booked: "Speaker double-booked",
  room_double_booked: "Room double-booked",
  track_overlap: "Track overlap",
};

/** Index of conflicts by each session they involve, so a board can look up
 * "what is wrong with this card" in O(1) while rendering. */
export function conflictsBySession(
  conflicts: ScheduleConflict[],
): Map<string, ScheduleConflict[]> {
  const bySession = new Map<string, ScheduleConflict[]>();
  for (const conflict of conflicts) {
    for (const sessionId of conflict.sessionIds) {
      const list = bySession.get(sessionId) ?? [];
      list.push(conflict);
      bySession.set(sessionId, list);
    }
  }
  return bySession;
}

/** The worst severity among `conflicts`, or null when there are none. */
export function worstSeverity(conflicts: ScheduleConflict[]): ConflictSeverity | null {
  if (conflicts.length === 0) return null;
  return conflicts.some((c) => CONFLICT_SEVERITY[c.type] === "blocking")
    ? "blocking"
    : "advisory";
}
