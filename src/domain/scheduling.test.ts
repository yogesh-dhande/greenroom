import { describe, expect, it } from "vitest";
import {
  conflictsBySession,
  detectConflicts,
  durationMinutes,
  enumerateDays,
  minutesOfDay,
  snapToGrid,
  timeOfMinutes,
  timeRangesOverlap,
  worstSeverity,
  type SessionWithSpeakers,
} from "@/domain/scheduling";

/** A placed session with sensible defaults, overridable per test. */
function session(overrides: Partial<SessionWithSpeakers> & { id: string }): SessionWithSpeakers {
  return {
    eventId: "evt-1",
    title: overrides.id,
    description: null,
    submissionId: null,
    trackId: null,
    roomId: null,
    day: "2026-08-12",
    startTime: "10:00",
    endTime: "10:30",
    status: "confirmed",
    speakerIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("time helpers", () => {
  it("round-trips HH:MM through minutes", () => {
    expect(minutesOfDay("09:15")).toBe(555);
    expect(timeOfMinutes(555)).toBe("09:15");
  });

  it("clamps minutes inside the day", () => {
    expect(timeOfMinutes(-30)).toBe("00:00");
    expect(timeOfMinutes(24 * 60 + 5)).toBe("23:59");
  });

  it("snaps to the 15-minute grid by default", () => {
    expect(snapToGrid(betweenSlots(10, 7))).toBe(minutesOfDay("10:00"));
    expect(snapToGrid(betweenSlots(10, 8))).toBe(minutesOfDay("10:15"));
  });

  it("computes durations on the same day", () => {
    expect(durationMinutes("10:00", "11:30")).toBe(90);
  });

  it("treats back-to-back ranges as non-overlapping (half-open)", () => {
    expect(timeRangesOverlap("10:00", "10:30", "10:30", "11:00")).toBe(false);
    expect(timeRangesOverlap("10:00", "10:31", "10:30", "11:00")).toBe(true);
  });
});

function betweenSlots(hour: number, offsetMinutes: number): number {
  return hour * 60 + offsetMinutes;
}

describe("enumerateDays", () => {
  it("enumerates an inclusive range", () => {
    expect(enumerateDays("2026-08-11", "2026-08-13")).toEqual([
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
  });

  it("handles missing or inverted bounds", () => {
    expect(enumerateDays(null, null)).toEqual([]);
    expect(enumerateDays(null, "2026-08-12")).toEqual(["2026-08-12"]);
    expect(enumerateDays("2026-08-12", "2026-08-10")).toEqual(["2026-08-12"]);
  });
});

describe("detectConflicts", () => {
  it("flags a room double-booking on overlapping times", () => {
    const conflicts = detectConflicts([
      session({ id: "a", roomId: "main", startTime: "10:00", endTime: "11:00" }),
      session({ id: "b", roomId: "main", startTime: "10:30", endTime: "11:30" }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe("room_double_booked");
    expect(conflicts[0].sessionIds).toEqual(["a", "b"]);
  });

  it("flags a speaker double-booking across different rooms", () => {
    const conflicts = detectConflicts([
      session({ id: "a", roomId: "main", speakerIds: ["u1"] }),
      session({ id: "b", roomId: "workshop", speakerIds: ["u1", "u2"] }),
    ]);
    expect(conflicts.map((c) => c.type)).toEqual(["speaker_double_booked"]);
  });

  it("flags a track overlap as its own conflict", () => {
    const conflicts = detectConflicts([
      session({ id: "a", trackId: "t1", roomId: "r1" }),
      session({ id: "b", trackId: "t1", roomId: "r2" }),
    ]);
    expect(conflicts.map((c) => c.type)).toEqual(["track_overlap"]);
  });

  it("ignores sessions on different days or non-overlapping times", () => {
    expect(
      detectConflicts([
        session({ id: "a", roomId: "main", day: "2026-08-12" }),
        session({ id: "b", roomId: "main", day: "2026-08-13" }),
        session({ id: "c", roomId: "main", startTime: "10:30", endTime: "11:00" }),
      ]),
    ).toEqual([]);
  });

  it("ignores unscheduled and cancelled sessions", () => {
    expect(
      detectConflicts([
        session({ id: "a", roomId: "main" }),
        session({ id: "b", roomId: "main", startTime: null, endTime: null }),
        session({ id: "c", roomId: "main", status: "cancelled" }),
      ]),
    ).toEqual([]);
  });

  it("reports every conflict type for one clashing pair", () => {
    const conflicts = detectConflicts([
      session({ id: "a", roomId: "main", trackId: "t1", speakerIds: ["u1"] }),
      session({ id: "b", roomId: "main", trackId: "t1", speakerIds: ["u1"] }),
    ]);
    expect(conflicts.map((c) => c.type).sort()).toEqual([
      "room_double_booked",
      "speaker_double_booked",
      "track_overlap",
    ]);
  });
});

describe("conflict presentation", () => {
  it("indexes conflicts by each involved session", () => {
    const conflicts = detectConflicts([
      session({ id: "a", roomId: "main" }),
      session({ id: "b", roomId: "main" }),
    ]);
    const bySession = conflictsBySession(conflicts);
    expect(bySession.get("a")).toHaveLength(1);
    expect(bySession.get("b")).toHaveLength(1);
    expect(bySession.get("missing")).toBeUndefined();
  });

  it("ranks blocking above advisory", () => {
    const advisory = detectConflicts([
      session({ id: "a", trackId: "t1" }),
      session({ id: "b", trackId: "t1" }),
    ]);
    const blocking = detectConflicts([
      session({ id: "a", roomId: "main" }),
      session({ id: "b", roomId: "main" }),
    ]);
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity(advisory)).toBe("advisory");
    expect(worstSeverity([...advisory, ...blocking])).toBe("blocking");
  });
});
