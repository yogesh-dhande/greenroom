import { describe, expect, it } from "vitest";
import {
  assertTimeZone,
  formatDayRange,
  formatDueDate,
  formatEventWhen,
  formatRelativeTime,
  wallClockDurationMinutes,
  zoneOffsetMs,
  zonedWallClockToInstant,
} from "@/lib/event-time";

const MINUTE = 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("zonedWallClockToInstant", () => {
  it("interprets the wall clock in the event's zone, not the server's", () => {
    // 09:00 in Los Angeles on a summer day is 16:00 UTC (UTC-7).
    expect(zonedWallClockToInstant("2026-06-16", "09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-06-16T16:00:00.000Z",
    );
    // The same wall clock in Berlin is 07:00 UTC (UTC+2).
    expect(zonedWallClockToInstant("2026-06-16", "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-06-16T07:00:00.000Z",
    );
  });

  it("uses the offset in force on the day itself, not today's offset", () => {
    // Winter: Los Angeles is UTC-8, so the same 09:00 is an hour later in UTC.
    expect(zonedWallClockToInstant("2026-01-16", "09:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-01-16T17:00:00.000Z",
    );
  });

  it("resolves times either side of a DST transition", () => {
    // US DST starts 2026-03-08 at 02:00 local.
    const before = zonedWallClockToInstant("2026-03-08", "01:00", "America/Los_Angeles");
    const after = zonedWallClockToInstant("2026-03-08", "03:00", "America/Los_Angeles");
    expect(before.toISOString()).toBe("2026-03-08T09:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-08T10:00:00.000Z");
    // Only one real hour passes across the skipped hour.
    expect(after.getTime() - before.getTime()).toBe(HOUR);
  });

  it("handles a zone with a half-hour offset", () => {
    expect(zonedWallClockToInstant("2026-06-16", "09:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-06-16T03:30:00.000Z",
    );
  });

  it("rejects malformed input rather than producing an Invalid Date", () => {
    expect(() => zonedWallClockToInstant("16 June", "09:00", "UTC")).toThrow();
    expect(() => zonedWallClockToInstant("2026-06-16", "morning", "UTC")).toThrow();
  });
});

describe("zoneOffsetMs", () => {
  it("is zero for UTC and signed for offsets west of Greenwich", () => {
    const summer = new Date("2026-06-16T12:00:00Z");
    expect(zoneOffsetMs(summer, "UTC")).toBe(0);
    expect(zoneOffsetMs(summer, "America/Los_Angeles")).toBe(-7 * HOUR);
    expect(zoneOffsetMs(summer, "Europe/Berlin")).toBe(2 * HOUR);
  });
});

describe("assertTimeZone", () => {
  it("accepts IANA identifiers and rejects anything else", () => {
    expect(() => assertTimeZone("America/New_York")).not.toThrow();
    expect(() => assertTimeZone("Pacific Time")).toThrow();
  });
});

describe("wallClockDurationMinutes", () => {
  it("measures the gap between two HH:MM values", () => {
    expect(wallClockDurationMinutes("09:00", "09:45")).toBe(45);
    expect(wallClockDurationMinutes("14:15", "15:00")).toBe(45);
  });

  it("treats an end before the start as crossing midnight", () => {
    expect(wallClockDurationMinutes("23:30", "00:15")).toBe(45);
  });
});

describe("formatting for humans", () => {
  it("names the day, the range and the zone the reader is standing in", () => {
    const when = formatEventWhen("2026-06-16", "09:00", "09:45", "America/Los_Angeles");
    expect(when).toContain("Tuesday");
    expect(when).toContain("June 16, 2026");
    expect(when).toContain("PDT");
  });

  it("collapses a date range that shares a month", () => {
    expect(formatDayRange("2026-06-16", "2026-06-18", "America/Los_Angeles")).toContain("2026");
  });
});

describe("formatDueDate", () => {
  // The regression this pins (decisions.md D-055): a task due date entered as
  // "2027-05-01" for an event in a zone *ahead* of UTC (e.g. Tokyo, UTC+9) is
  // stored as that wall clock's instant (`fromZonedInputValue` /
  // `zonedWallClockToInstant`) — 2027-04-30T15:00:00Z, already the *previous*
  // UTC day. `src/components/date-format.ts`'s zone-less `formatDate` calls
  // `toLocaleDateString` with no timeZone, which on Cloudflare Workers means
  // UTC, so it reads that instant back as Apr 30 — one day early. Passing the
  // event's real zone is exactly what fixes it.
  const dueMidnightTokyo = zonedWallClockToInstant("2027-05-01", "00:00", "Asia/Tokyo");

  it("renders the entered calendar day when given the event's own zone", () => {
    expect(formatDueDate(dueMidnightTokyo, "Asia/Tokyo")).toBe("May 1, 2027");
  });

  it("renders a day early in UTC — the exact bug report (2027-05-01 → Apr 30)", () => {
    // UTC is what a bare, zone-less `toLocaleDateString` resolves to on
    // Cloudflare Workers — this is the "Apr 30, 2027" the eval caught.
    expect(formatDueDate(dueMidnightTokyo, "UTC")).toBe("Apr 30, 2027");
  });

  it("includes the year, unlike the zone-less formatShortDate sibling", () => {
    expect(formatDueDate(dueMidnightTokyo, "Asia/Tokyo")).toContain("2027");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0); // 2026-08-09T12:00:00Z

  it("reads as 'just now' for anything under a minute, including future skew", () => {
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now, now - 30 * 1000)).toBe("just now");
    // A `thenMs` after `now` (clock skew) must not go negative.
    expect(formatRelativeTime(now, now + 5000)).toBe("just now");
  });

  it("counts whole minutes up to the hour boundary", () => {
    expect(formatRelativeTime(now, now - MINUTE)).toBe("1m ago");
    expect(formatRelativeTime(now, now - 59 * MINUTE)).toBe("59m ago");
  });

  it("switches to hours at exactly 60 minutes and counts whole hours up to a day", () => {
    expect(formatRelativeTime(now, now - HOUR)).toBe("1h ago");
    expect(formatRelativeTime(now, now - 23 * HOUR)).toBe("23h ago");
  });

  it("switches to days at exactly 24 hours and counts whole days up to the horizon", () => {
    expect(formatRelativeTime(now, now - DAY)).toBe("1d ago");
    expect(formatRelativeTime(now, now - 6 * DAY)).toBe("6d ago");
  });

  it("falls back to an absolute UTC date at the 7-day horizon and beyond", () => {
    expect(formatRelativeTime(now, now - 7 * DAY)).toBe("Aug 2, 2026");
    expect(formatRelativeTime(now, now - 30 * DAY)).toBe("Jul 10, 2026");
  });

  it("keeps counting days when the caller pushes the horizon out", () => {
    // The sourcing table's Last touch column: staleness is the whole point,
    // so a month-old prospect reads "34d ago" rather than as a calendar date.
    const forever = { horizonMs: Number.POSITIVE_INFINITY };
    expect(formatRelativeTime(now, now - 34 * DAY, forever)).toBe("34d ago");
    expect(formatRelativeTime(now, now - 400 * DAY, forever)).toBe("400d ago");
  });

  it("keeps the smaller units under a custom horizon", () => {
    const forever = { horizonMs: Number.POSITIVE_INFINITY };
    expect(formatRelativeTime(now, now, forever)).toBe("just now");
    expect(formatRelativeTime(now, now - 5 * MINUTE, forever)).toBe("5m ago");
    expect(formatRelativeTime(now, now - 5 * HOUR, forever)).toBe("5h ago");
  });
});
