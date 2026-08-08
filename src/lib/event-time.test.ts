import { describe, expect, it } from "vitest";
import {
  assertTimeZone,
  formatDayRange,
  formatEventWhen,
  wallClockDurationMinutes,
  zoneOffsetMs,
  zonedWallClockToInstant,
} from "@/lib/event-time";

const HOUR = 60 * 60 * 1000;

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
