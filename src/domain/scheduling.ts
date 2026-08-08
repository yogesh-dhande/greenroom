/**
 * Scheduling domain service — agenda conflict detection (spec.md §5). Pure
 * TypeScript: no datastore imports. Callers fetch Session/Room/Track rows
 * via src/db/repos/* and pass plain entities in.
 */
import type { Session } from "@/db/entities";

export type ConflictType = "speaker_double_booked" | "room_double_booked" | "track_overlap";

export interface ScheduleConflict {
  type: ConflictType;
  sessionIds: string[];
  message: string;
}

export interface SessionWithSpeakers extends Session {
  speakerIds: string[];
}

/**
 * Detects the three conflict types called out in spec.md §5: the same
 * speaker double-booked, the same room double-booked, and overlapping
 * sessions within a track. Run this whenever a session is placed/moved on
 * the agenda builder.
 */
export function detectConflicts(sessions: SessionWithSpeakers[]): ScheduleConflict[] {
  // TODO: for each pair of sessions with overlapping [startTime, endTime):
  //  - same room -> room_double_booked
  //  - same track -> track_overlap
  //  - shared speakerId -> speaker_double_booked
  // O(n^2) pairwise comparison is fine at conference scale.
  return [];
}

/** True if two [start, end) time ranges overlap. Exposed for reuse/testing
 * by detectConflicts and any UI-side pre-check before a drag-and-drop
 * placement is committed. */
export function timeRangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
