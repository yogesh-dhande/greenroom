/**
 * Small formatting helpers shared by the admin/portal pages. `day` and
 * date-range values from the data layer are plain "YYYY-MM-DD" strings with
 * no timezone info (see src/db/entities.ts) — parsed and formatted as UTC so
 * the calendar date never shifts by a day depending on the viewer's clock.
 */

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
};

const DAY_FORMAT_WITH_YEAR: Intl.DateTimeFormatOptions = {
  ...DAY_FORMAT,
  year: "numeric",
};

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "Aug 8" / "Aug 8, 2026" for a single "YYYY-MM-DD" day string. */
export function formatDay(day: string, withYear = false): string {
  return parseDay(day).toLocaleDateString("en-US", withYear ? DAY_FORMAT_WITH_YEAR : DAY_FORMAT);
}

/** "Aug 8 – Aug 10, 2026" for an event's start/end dates, or a sensible
 * fallback when one or both are unset. */
export function formatDateRange(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return "Dates TBD";
  if (startDate && endDate && startDate !== endDate) {
    return `${formatDay(startDate)} – ${formatDay(endDate, true)}`;
  }
  return formatDay((startDate ?? endDate)!, true);
}

/** "9:00 AM" for a "HH:MM" 24h time string. */
export function formatTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "Aug 8, 2026" for a Date (e.g. a task's dueAt). */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
