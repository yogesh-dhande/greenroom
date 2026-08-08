/**
 * Event-timezone arithmetic and human-readable formatting.
 *
 * Sessions store a calendar day ("YYYY-MM-DD") plus wall-clock times
 * ("HH:MM") in the *event's* IANA timezone rather than instants (see the
 * comments on `sessions` in src/db/schema.ts). That keeps drag-and-drop
 * scheduling and conflict detection free of timezone arithmetic — but the
 * moment we emit a calendar invite or an email, those local strings have to
 * be turned into a real instant using the event's zone, not the server's.
 *
 * Everything here is built on `Intl` (available in Node and in workerd, which
 * ships the full ICU timezone database), so there is no timezone dependency
 * to install.
 */

/** Throws a clear error rather than letting `Intl`'s RangeError surface. */
export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(
      `Unknown IANA timezone "${timeZone}". Set a valid zone on the event (e.g. "America/Los_Angeles").`,
    );
  }
}

const PART_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PART_FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      // `hour12: false` yields "24" for midnight in en-US; h23 yields "00".
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PART_FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** UTC offset of `timeZone` at `instant`, in milliseconds (east positive). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = partFormatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  const localAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  // Compare against the instant truncated to whole seconds, because
  // Date.UTC() above has no milliseconds component.
  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock day/time in `timeZone` into the instant it denotes.
 *
 * The two-pass refinement handles DST: the first pass guesses the offset
 * using the naive instant, the second re-checks it at the corrected instant.
 * Times that fall in a DST "spring forward" gap resolve to the instant just
 * after the transition; ambiguous "fall back" times resolve to the first
 * (pre-transition) occurrence — the same convention as most calendar apps.
 */
export function zonedWallClockToInstant(day: string, time: string, timeZone: string): Date {
  assertTimeZone(timeZone);
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, date, hour, minute].some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid event day/time: "${day}" "${time}" (expected YYYY-MM-DD and HH:MM)`);
  }

  const naive = Date.UTC(year, month - 1, date, hour, minute, 0);
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const refined = naive - zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(refined);
}

/** Minutes between two wall-clock times, rolling over midnight if needed. */
export function wallClockDurationMinutes(startTime: string, endTime: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  return end > start ? end - start : end + 24 * 60 - start;
}

// ---------------------------------------------------------------------------
// Formatting — every string a speaker reads is rendered in the event's zone,
// with the zone abbreviation spelled out so it is never ambiguous.
// ---------------------------------------------------------------------------

function format(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(instant);
}

/** Midday on `day` — a safe instant for formatting a date-only value. */
function middayOf(day: string, timeZone: string): Date {
  return zonedWallClockToInstant(day, "12:00", timeZone);
}

/** "Tuesday, June 16, 2026" */
export function formatEventDay(day: string, timeZone: string): string {
  return format(middayOf(day, timeZone), timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "PDT" — the zone abbreviation in effect at `instant`. */
export function formatZoneAbbreviation(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/** "10:00 AM – 10:45 AM PDT" */
export function formatEventTimeRange(
  day: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): string {
  const start = zonedWallClockToInstant(day, startTime, timeZone);
  const end = zonedWallClockToInstant(day, endTime, timeZone);
  const time = (instant: Date) =>
    format(instant, timeZone, { hour: "numeric", minute: "2-digit" });
  return `${time(start)} – ${time(end)} ${formatZoneAbbreviation(start, timeZone)}`;
}

/** "Tuesday, June 16, 2026, 10:00 AM – 10:45 AM PDT" — the one-line answer to
 * "when is my talk?", used in email copy and the .ics description. */
export function formatEventWhen(
  day: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): string {
  return `${formatEventDay(day, timeZone)}, ${formatEventTimeRange(day, startTime, endTime, timeZone)}`;
}

/** "June 16–18, 2026", or a single date when the event is one day long. */
export function formatDayRange(
  startDay: string | null,
  endDay: string | null,
  timeZone: string,
): string {
  if (!startDay && !endDay) return "";
  if (!startDay || !endDay || startDay === endDay) {
    return formatEventDay((startDay ?? endDay) as string, timeZone).replace(/^\w+, /, "");
  }
  const start = middayOf(startDay, timeZone);
  const end = middayOf(endDay, timeZone);
  const sameMonth =
    format(start, timeZone, { month: "long", year: "numeric" }) ===
    format(end, timeZone, { month: "long", year: "numeric" });
  if (sameMonth) {
    const month = format(start, timeZone, { month: "long" });
    const year = format(start, timeZone, { year: "numeric" });
    return `${month} ${format(start, timeZone, { day: "numeric" })}–${format(end, timeZone, { day: "numeric" })}, ${year}`;
  }
  const short = (instant: Date) =>
    format(instant, timeZone, { month: "long", day: "numeric", year: "numeric" });
  return `${short(start)} – ${short(end)}`;
}

/** "June 5" — compact form for checklist rows. */
export function formatShortDate(instant: Date, timeZone: string): string {
  return format(instant, timeZone, { month: "long", day: "numeric" });
}

/** "Friday, June 5, 2026 at 5:00 PM PDT" — deadlines are stored as instants. */
export function formatDeadline(instant: Date, timeZone: string): string {
  const date = format(instant, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = format(instant, timeZone, { hour: "numeric", minute: "2-digit" });
  return `${date} at ${time} ${formatZoneAbbreviation(instant, timeZone)}`;
}
