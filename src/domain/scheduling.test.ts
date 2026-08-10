import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_MINUTES,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  conflictsBySession,
  detectConflicts,
  durationMinutes,
  enumerateDays,
  firstConflictFreeSlot,
  isValidSessionDuration,
  minutesOfDay,
  preferredSessionDuration,
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
    contentStatus: "approved",
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

describe("firstConflictFreeSlot (decisions.md D-067)", () => {
  const days = ["2026-08-11", "2026-08-12"];
  const rooms = ["room-a", "room-b"];

  /** The session being placed: in the tray, so it has no day or times yet. */
  function unplaced(overrides: Partial<SessionWithSpeakers> = {}): SessionWithSpeakers {
    return session({ id: "candidate", day: null, startTime: null, endTime: null, ...overrides });
  }

  function suggest(
    candidate: SessionWithSpeakers,
    board: SessionWithSpeakers[],
    overrides: Partial<Parameters<typeof firstConflictFreeSlot>[0]> = {},
  ) {
    return firstConflictFreeSlot({
      session: candidate,
      sessions: [candidate, ...board],
      days,
      roomIds: rooms,
      durationMinutes: 30,
      ...overrides,
    });
  }

  it("suggests the first slot of the first day on an empty agenda", () => {
    expect(suggest(unplaced(), [])).toEqual({
      day: "2026-08-11",
      startTime: "08:00",
      endTime: "08:30",
      roomId: "room-a",
    });
  });

  it("moves to the next room when the first one is taken", () => {
    const board = [
      session({ id: "held", day: "2026-08-11", startTime: "08:00", endTime: "09:00", roomId: "room-a" }),
    ];
    expect(suggest(unplaced(), board)).toEqual({
      day: "2026-08-11",
      startTime: "08:00",
      endTime: "08:30",
      roomId: "room-b",
    });
  });

  it("moves to the next slot when the speaker is busy in every room", () => {
    const board = [
      session({
        id: "held",
        day: "2026-08-11",
        startTime: "08:00",
        endTime: "08:30",
        roomId: "room-a",
        speakerIds: ["u1"],
      }),
    ];
    // 08:00 and 08:15 overlap the speaker's other talk in both rooms, so the
    // earliest clean start is right after it ends.
    expect(suggest(unplaced({ speakerIds: ["u1"] }), board)).toEqual({
      day: "2026-08-11",
      startTime: "08:30",
      endTime: "09:00",
      roomId: "room-a",
    });
  });

  it("returns null when every room on every day is booked solid", () => {
    const board = days.flatMap((day) =>
      rooms.map((roomId) =>
        session({ id: `${day}-${roomId}`, day, startTime: "09:00", endTime: "10:00", roomId }),
      ),
    );
    expect(
      suggest(unplaced(), board, {
        durationMinutes: 60,
        window: { startMinute: 9 * 60, endMinute: 10 * 60 },
      }),
    ).toBeNull();
  });

  it("returns null when the session is longer than the searchable day", () => {
    expect(suggest(unplaced(), [], { durationMinutes: 13 * 60 })).toBeNull();
  });

  it("does not let a track overlap rule a slot out", () => {
    const board = [
      session({
        id: "held",
        day: "2026-08-11",
        startTime: "08:00",
        endTime: "09:00",
        roomId: "room-a",
        trackId: "t1",
      }),
    ];
    expect(suggest(unplaced({ trackId: "t1" }), board)?.roomId).toBe("room-b");
  });

  it("ignores the session's own current placement when suggesting a move", () => {
    const placed = session({
      id: "candidate",
      day: "2026-08-12",
      startTime: "15:00",
      endTime: "15:30",
      roomId: "room-b",
    });
    expect(suggest(placed, [])).toEqual({
      day: "2026-08-11",
      startTime: "08:00",
      endTime: "08:30",
      roomId: "room-a",
    });
  });

  it("suggests a roomless slot when the event has no rooms yet", () => {
    expect(suggest(unplaced(), [], { roomIds: [] })?.roomId).toBeNull();
  });
});

describe("preferredSessionDuration (bug: 'Suggest a slot' reset duration to the default)", () => {
  it("preserves a scheduled session's own duration, not the generic default", () => {
    // A 15-minute lightning talk, already placed on the agenda.
    const lightningTalk = session({ id: "a", startTime: "09:00", endTime: "09:15" });
    expect(preferredSessionDuration(lightningTalk, DEFAULT_SESSION_MINUTES)).toBe(15);
  });

  it("preserves a duration shorter than the default just as readily as a longer one", () => {
    const workshop = session({ id: "a", startTime: "13:00", endTime: "14:30" });
    expect(preferredSessionDuration(workshop, DEFAULT_SESSION_MINUTES)).toBe(90);
  });

  it("falls back to the given default only when the session has no placement yet", () => {
    const unplaced = session({ id: "a", day: null, startTime: null, endTime: null });
    expect(preferredSessionDuration(unplaced, DEFAULT_SESSION_MINUTES)).toBe(
      DEFAULT_SESSION_MINUTES,
    );
    expect(preferredSessionDuration(unplaced, 45)).toBe(45);
  });

  it("falls back when only one of startTime/endTime is set", () => {
    const partial = session({ id: "a", startTime: "09:00", endTime: null });
    expect(preferredSessionDuration(partial, DEFAULT_SESSION_MINUTES)).toBe(
      DEFAULT_SESSION_MINUTES,
    );
  });

  it("falls back on a non-positive stored duration rather than returning zero or negative", () => {
    const zeroLength = session({ id: "a", startTime: "09:00", endTime: "09:00" });
    expect(preferredSessionDuration(zeroLength, DEFAULT_SESSION_MINUTES)).toBe(
      DEFAULT_SESSION_MINUTES,
    );
  });

  it("defaults the fallback parameter to DEFAULT_SESSION_MINUTES when omitted", () => {
    const unplaced = session({ id: "a", day: null, startTime: null, endTime: null });
    expect(preferredSessionDuration(unplaced)).toBe(DEFAULT_SESSION_MINUTES);
  });
});

describe("isValidSessionDuration (custom duration entry bounds)", () => {
  it("accepts whole minutes inside the bounds, including below the smallest preset", () => {
    expect(isValidSessionDuration(10)).toBe(true);
    expect(isValidSessionDuration(MIN_SESSION_MINUTES)).toBe(true);
    expect(isValidSessionDuration(MAX_SESSION_MINUTES)).toBe(true);
  });

  it("rejects anything outside [MIN_SESSION_MINUTES, MAX_SESSION_MINUTES]", () => {
    expect(isValidSessionDuration(MIN_SESSION_MINUTES - 1)).toBe(false);
    expect(isValidSessionDuration(MAX_SESSION_MINUTES + 1)).toBe(false);
    expect(isValidSessionDuration(0)).toBe(false);
    expect(isValidSessionDuration(-15)).toBe(false);
  });

  it("rejects a non-integer number of minutes", () => {
    expect(isValidSessionDuration(15.5)).toBe(false);
    expect(isValidSessionDuration(NaN)).toBe(false);
  });
});
