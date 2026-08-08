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

/** "HH:MM" -> minutes since midnight. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
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
