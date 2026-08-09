/**
 * iCalendar (.ics) generation — serialized by hand in this module (decisions.md
 * D-003, D-008). This used to wrap the `ics` npm package, but that package
 * (plus the `yup` dependency it drags in) cost ~17 KiB of gzipped Worker
 * bundle we could not afford under the free plan's 3 MiB cap, and the exact
 * bytes we emit are load-bearing for client compatibility anyway — better to
 * own them. `inspectIcs()` below and the unit tests check the output against
 * the RFCs, so the swap was made under an existing safety net. Domain code
 * calls `buildCalendarInvite()` and never sees serialization details.
 *
 * Design notes, all of which are load-bearing for "the invite actually works
 * in Gmail, Outlook and Apple Calendar":
 *
 * **Times are emitted in UTC, derived from the event's IANA zone.**
 * RFC 5545 §3.2.19 requires a matching `VTIMEZONE` component for every
 * `TZID` parameter, and Microsoft documents that when Outlook cannot resolve
 * a `TZID` it silently falls back to *the recipient's* local timezone
 * (MS-STANOICAL §RFC5545 3.2.19, V0032) — i.e. a 10:00 Los Angeles talk
 * becomes 10:00 wherever the speaker happens to be. Rather than emit
 * VTIMEZONE blocks (a database we'd have to maintain), we emit UTC
 * `DTSTART`/`DTEND` (`...Z`), which every client resolves identically. The
 * conversion from the event's wall clock to that instant happens in
 * src/lib/event-time.ts; the human-readable local time is repeated in the
 * DESCRIPTION and in the email body so the speaker still sees "10:00 AM PDT".
 *
 * **Stable UID + monotonic SEQUENCE.** `calendarUidForSession()` derives the
 * UID from the session id, so a re-send after a room or time change updates
 * the existing calendar entry instead of creating a second one. RFC 5546
 * §2.1.4 requires SEQUENCE to increase whenever DTSTART/DTEND/STATUS change,
 * or when a LOCATION change is significant enough to affect attendance —
 * which covers every reason we re-send.
 *
 * **ORGANIZER matches the From address.** RFC 6047 §2.3 does not require it,
 * but clients treat a mismatch as a spoofing signal and RSVP replies are
 * addressed to ORGANIZER, so src/domain/comms.ts always passes the sender
 * identity through.
 */
import {
  formatEventWhen,
  wallClockDurationMinutes,
  zonedWallClockToInstant,
} from "@/lib/event-time";

/** iTIP methods we produce. `PUBLISH` is deliberately absent: a speaker
 * invite is always a scheduling request addressed to that speaker. */
export type CalendarMethod = "REQUEST" | "CANCEL";

export type CalendarRole = "CHAIR" | "REQ-PARTICIPANT" | "OPT-PARTICIPANT";

export interface CalendarPerson {
  name?: string | null;
  email: string;
}

export interface CalendarAttendee extends CalendarPerson {
  role?: CalendarRole;
  /** `NEEDS-ACTION` on a REQUEST is what makes clients show RSVP buttons. */
  partstat?: "NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE";
  rsvp?: boolean;
}

export interface CalendarInviteInput {
  /** Stable across every send for the same session — see calendarUidForSession(). */
  uid: string;
  /** 0 for the first send; increment on every subsequent send. */
  sequence: number;
  method: CalendarMethod;
  title: string;
  description?: string | null;
  /** Room name, or null while the room is still unassigned (spec.md §7:
   * invites may be sent before a room exists and updated afterwards). */
  location?: string | null;
  url?: string | null;
  /** IANA zone of the event — the frame `day`/`startTime`/`endTime` live in. */
  timeZone: string;
  /** "YYYY-MM-DD" in `timeZone`. */
  day: string;
  /** "HH:MM" in `timeZone`. */
  startTime: string;
  endTime: string;
  organizer: CalendarPerson;
  attendees: CalendarAttendee[];
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Overrides DTSTAMP — only for deterministic tests/fixtures. */
  stamp?: Date;
  /** Appears in PRODID. */
  productId?: string;
}

export interface CalendarInvite {
  uid: string;
  sequence: number;
  method: CalendarMethod;
  /** The iCalendar object, CRLF-delimited per RFC 5545 §3.1. */
  content: string;
  filename: string;
  /**
   * The full MIME type the part must carry. RFC 6047 §2.4 makes the `method`
   * parameter mandatory, and Microsoft documents that Outlook only treats a
   * part as an invitation when its Content-Type is `text/calendar`
   * (MS-STANOICAL §RFC6047 2.4) — the widespread `application/ics` advice is
   * for *other* clients, not Outlook.
   */
  contentType: string;
  /** Resolved instants, handy for logging and for the email body. */
  startsAt: Date;
  endsAt: Date;
}

const DEFAULT_PRODUCT_ID = "-//Greenroom//Speaker Calendar Invite//EN";

/** `text/calendar; charset=utf-8; method=REQUEST` */
export function calendarContentType(method: CalendarMethod): string {
  return `text/calendar; charset=utf-8; method=${method}`;
}

/**
 * Deterministic UID for a session's calendar entry. RFC 7986 §5.3 recommends
 * the `local-part@domain` form; deriving it from the session id means we never
 * have to persist it, and a re-send always addresses the same calendar entry.
 */
export function calendarUidForSession(sessionId: string, domain = "greenroom.dev"): string {
  return `session-${sessionId}@${domain}`;
}

/** "20260616T170000Z" — the UTC date-time form of RFC 5545 §3.3.5. */
function formatStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** TEXT value escaping per RFC 5545 §3.3.11: backslash first, then the rest. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Parameter values (e.g. `CN=`) can't be backslash-escaped; RFC 5545 §3.2
 * quotes them instead, and DQUOTE itself is not representable — drop it.
 */
function quoteParam(value: string): string {
  const cleaned = value.replace(/"/g, "").replace(/\r?\n/g, " ");
  return /[;:,]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

const encoder = new TextEncoder();

/**
 * Folds one content line at 75 octets (RFC 5545 §3.1), continuation lines
 * prefixed with a single space and themselves kept within the limit. Counts
 * octets, not characters, and never splits inside a code point.
 */
function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > 75) {
      parts.push(current);
      current = " ";
      octets = 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/** One CRLF-delimited iCalendar object from unfolded content lines. */
function serialize(unfoldedLines: string[]): string {
  return `${unfoldedLines.map(foldLine).join("\r\n")}\r\n`;
}

function organizerLine(person: CalendarPerson): string {
  const cn = person.name ? `;CN=${quoteParam(person.name)}` : "";
  return `ORGANIZER${cn}:mailto:${person.email}`;
}

function attendeeLine(attendee: CalendarAttendee, method: CalendarMethod): string {
  const params = [
    `RSVP=${(attendee.rsvp ?? method === "REQUEST") ? "TRUE" : "FALSE"}`,
    "CUTYPE=INDIVIDUAL",
    `PARTSTAT=${attendee.partstat ?? (method === "CANCEL" ? "ACCEPTED" : "NEEDS-ACTION")}`,
    `ROLE=${attendee.role ?? "REQ-PARTICIPANT"}`,
    ...(attendee.name ? [`CN=${quoteParam(attendee.name)}`] : []),
  ];
  return `ATTENDEE;${params.join(";")}:mailto:${attendee.email}`;
}

/** Builds the .ics object for one session invite. */
export function buildCalendarInvite(input: CalendarInviteInput): CalendarInvite {
  const startsAt = zonedWallClockToInstant(input.day, input.startTime, input.timeZone);
  const durationMinutes = wallClockDurationMinutes(input.startTime, input.endTime);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  const when = formatEventWhen(input.day, input.startTime, input.endTime, input.timeZone);
  const descriptionParts = [input.description?.trim(), when].filter(Boolean) as string[];

  const content = serialize([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.productId ?? DEFAULT_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${formatStamp(input.stamp ?? new Date())}`,
    `DTSTART:${formatStamp(startsAt)}`,
    `DTEND:${formatStamp(endsAt)}`,
    `SUMMARY:${escapeText(input.title)}`,
    `DESCRIPTION:${escapeText(descriptionParts.join("\n\n"))}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    ...(input.url ? [`URL:${input.url}`] : []),
    `STATUS:${input.status ?? (input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED")}`,
    // Outlook reads free/busy from the X- property rather than TRANSP.
    "TRANSP:OPAQUE",
    "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    organizerLine(input.organizer),
    ...input.attendees.map((attendee) => attendeeLine(attendee, input.method)),
    "END:VEVENT",
    "END:VCALENDAR",
  ]);

  return {
    uid: input.uid,
    sequence: input.sequence,
    method: input.method,
    content,
    filename: "invite.ics",
    contentType: calendarContentType(input.method),
    startsAt,
    endsAt,
  };
}

// ---------------------------------------------------------------------------
// Personal itinerary export — a *calendar file*, not an invitation.
//
// `buildCalendarInvite` above is deliberately iTIP-shaped: one VEVENT with
// METHOD:REQUEST, an ORGANIZER and ATTENDEEs, because it is a scheduling
// request addressed to a named speaker. An attendee downloading their starred
// sessions wants the opposite: several VEVENTs, no organizer to RSVP to, no
// attendee list, and METHOD:PUBLISH — RFC 5546 §3.2.1's "here is an event".
// Sharing the invite builder would mean threading "not a request, no
// organizer, no attendees" through every field of it, so this is a second
// entry point over the same serializer instead (decisions.md D-003, D-008).
// ---------------------------------------------------------------------------

export interface ItineraryEntry {
  /** The session id — the UID is derived from it, so re-downloading after
   * starring one more talk updates the existing entries rather than
   * duplicating them. */
  sessionId: string;
  title: string;
  description?: string | null;
  /** Room name, or null while the room is still unassigned. */
  location?: string | null;
  /** "YYYY-MM-DD" in `timeZone`. */
  day: string;
  /** "HH:MM" in `timeZone`. */
  startTime: string;
  endTime: string;
}

export interface ItineraryCalendarInput {
  /** IANA zone of the event — the frame the day/times live in. */
  timeZone: string;
  entries: ItineraryEntry[];
  /** Shown as the calendar's name in clients that honour X-WR-CALNAME. */
  calendarName?: string;
  /** Basename of the downloaded file, without the extension. */
  filenameBase?: string;
  productId?: string;
  /** Overrides DTSTAMP — only for deterministic tests/fixtures. */
  stamp?: Date;
}

export interface ItineraryCalendar {
  content: string;
  filename: string;
  /** No `method=` parameter: this is a plain calendar file, not an iTIP part. */
  contentType: string;
}

const ITINERARY_PRODUCT_ID = "-//Greenroom//Personal Schedule//EN";

/** UID for one starred session in an attendee's personal calendar. Distinct
 * from `calendarUidForSession` so importing your itinerary never collides
 * with the speaker invite already sitting in the same calendar. */
export function itineraryUidForSession(sessionId: string, domain = "greenroom.dev"): string {
  return `itinerary-${sessionId}@${domain}`;
}

/**
 * Builds a single .ics holding one VEVENT per starred session. Times are
 * emitted in UTC for exactly the reason documented at the top of this file:
 * we write no VTIMEZONE, so a TZID would be unresolvable and Outlook would
 * silently reinterpret it in the reader's own zone.
 */
export function buildItineraryCalendar(input: ItineraryCalendarInput): ItineraryCalendar {
  if (input.entries.length === 0) {
    throw new Error("Cannot build an itinerary calendar with no sessions");
  }

  const stamp = formatStamp(input.stamp ?? new Date());
  const events = input.entries.flatMap((entry) => {
    const startsAt = zonedWallClockToInstant(entry.day, entry.startTime, input.timeZone);
    const endsAt = new Date(
      startsAt.getTime() + wallClockDurationMinutes(entry.startTime, entry.endTime) * 60_000,
    );
    const when = formatEventWhen(entry.day, entry.startTime, entry.endTime, input.timeZone);
    return [
      "BEGIN:VEVENT",
      `UID:${itineraryUidForSession(entry.sessionId)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatStamp(startsAt)}`,
      `DTEND:${formatStamp(endsAt)}`,
      `SUMMARY:${escapeText(entry.title)}`,
      `DESCRIPTION:${escapeText([entry.description?.trim(), when].filter(Boolean).join("\n\n"))}`,
      ...(entry.location ? [`LOCATION:${escapeText(entry.location)}`] : []),
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
      "END:VEVENT",
    ];
  });

  return wrapCalendar(input, events);
}

/**
 * A VCALENDAR with no VEVENTs — what a public feed serves while its program
 * is unpublished (decisions.md D-056). A subscribed calendar client must get
 * a parseable document rather than a 404, which it would surface to the user
 * as a broken subscription.
 */
export function buildEmptyCalendar(
  input: Omit<ItineraryCalendarInput, "entries" | "timeZone">,
): ItineraryCalendar {
  return wrapCalendar(input, []);
}

function wrapCalendar(
  input: Omit<ItineraryCalendarInput, "entries" | "timeZone">,
  events: string[],
): ItineraryCalendar {
  const content = serialize([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.productId ?? ITINERARY_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(input.calendarName ? [`X-WR-CALNAME:${escapeText(input.calendarName)}`] : []),
    ...events,
    "END:VCALENDAR",
  ]);

  return {
    content,
    filename: `${input.filenameBase ?? "my-schedule"}.ics`,
    contentType: "text/calendar; charset=utf-8",
  };
}

// ---------------------------------------------------------------------------
// Validation — we do not take the library's word for RFC compliance.
// ---------------------------------------------------------------------------

export interface IcsInspection {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Every content line, unfolded, keyed by property name. */
  properties: Record<string, string[]>;
}

/** Unfolds RFC 5545 §3.1 line folding (CRLF followed by a single space/tab). */
export function unfoldIcs(content: string): string[] {
  return content.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

/**
 * Checks a generated invite against the RFC 5546 §3.2.2 constraint table for
 * `METHOD:REQUEST` plus the client-compatibility rules this codebase relies
 * on. Used by scripts/send-test-email.ts; cheap enough to call in a test.
 */
export function inspectIcs(content: string, expected?: { method?: CalendarMethod }): IcsInspection {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content.includes("\r\n")) errors.push("Content lines are not CRLF-delimited (RFC 5545 §3.1)");
  if (/(?<!\r)\n/.test(content)) errors.push("Found a bare LF line ending (RFC 5545 §3.1)");

  const lines = unfoldIcs(content);
  const properties: Record<string, string[]> = {};
  for (const line of lines) {
    const separator = line.search(/[;:]/);
    if (separator < 0) continue;
    const name = line.slice(0, separator).toUpperCase();
    (properties[name] ??= []).push(line.slice(separator + 1));
  }

  const first = (name: string): string | undefined => properties[name]?.[0];
  const require = (name: string, why: string) => {
    if (!properties[name]?.length) errors.push(`Missing ${name} — ${why}`);
  };

  if (lines[0] !== "BEGIN:VCALENDAR") errors.push("Object does not start with BEGIN:VCALENDAR");
  if (lines[lines.length - 1] !== "END:VCALENDAR") errors.push("Object does not end with END:VCALENDAR");
  if (first("VERSION") !== "2.0") errors.push('VERSION must be "2.0" (RFC 5545 §3.7.4)');
  require("PRODID", "RFC 5545 §3.7.3 requires it");
  require("BEGIN", "no VEVENT component found");

  const method = first("METHOD");
  if (!method) {
    errors.push("Missing METHOD — an iTIP object needs one (RFC 5546 §3.2)");
  } else if (expected?.method && method !== expected.method) {
    errors.push(`METHOD is ${method}, expected ${expected.method}`);
  }

  require("UID", "RFC 5546 §3.2.2 requires exactly one per VEVENT");
  require("DTSTAMP", "RFC 5546 §3.2.2 requires exactly one");
  require("DTSTART", "RFC 5546 §3.2.2 requires exactly one");
  require("SUMMARY", "RFC 5546 §3.2.2 requires exactly one");
  if (!properties.DTEND?.length && !properties.DURATION?.length) {
    errors.push("Missing DTEND/DURATION — one of the two is required");
  }

  const organizer = first("ORGANIZER");
  if (!organizer) {
    errors.push("Missing ORGANIZER — required for METHOD:REQUEST (RFC 5546 §3.2.2)");
  } else if (!/mailto:/i.test(organizer)) {
    errors.push("ORGANIZER value is not a mailto: URI (RFC 6047 §2.3)");
  }

  const attendees = properties.ATTENDEE ?? [];
  if (attendees.length === 0) {
    errors.push("Missing ATTENDEE — at least one is required for METHOD:REQUEST");
  }
  for (const attendee of attendees) {
    if (!/mailto:/i.test(attendee)) {
      errors.push("ATTENDEE value is not a mailto: URI (RFC 6047 §2.3)");
    }
  }
  if (method === "REQUEST" && !attendees.some((a) => /PARTSTAT=("?)NEEDS-ACTION\1/.test(a))) {
    warnings.push("No attendee has PARTSTAT=NEEDS-ACTION; clients may not offer RSVP buttons");
  }

  const sequence = first("SEQUENCE");
  if (sequence === undefined) {
    warnings.push("No SEQUENCE — required once it exceeds 0 (RFC 5546 §3.2.2)");
  } else if (!/^\d+$/.test(sequence)) {
    errors.push(`SEQUENCE is not a non-negative integer: "${sequence}"`);
  }

  if (properties["REQUEST-STATUS"]?.length) {
    errors.push("REQUEST-STATUS MUST NOT appear in a REQUEST (RFC 5546 §3.2.2)");
  }

  const usesTzid = lines.some((line) => /^(DTSTART|DTEND|DUE|EXDATE|RDATE)[^:]*;TZID=/.test(line));
  const hasVtimezone = lines.includes("BEGIN:VTIMEZONE");
  if (usesTzid && !hasVtimezone) {
    errors.push(
      "A TZID parameter is used with no VTIMEZONE component — RFC 5545 §3.2.19; Outlook falls back to the recipient's local zone",
    );
  }
  const floating = lines.some((line) => /^DTSTART:\d{8}T\d{6}$/.test(line));
  if (floating) {
    errors.push("DTSTART is floating local time (no Z, no TZID) — it will render in the reader's zone");
  }

  for (const line of content.split("\r\n")) {
    // RFC 5545 §3.1: octets, but 75 characters is a safe proxy for our ASCII-
    // dominant output and catches unfolded long values.
    if (line.length > 75) warnings.push(`Content line exceeds 75 octets: "${line.slice(0, 40)}…"`);
  }

  return { ok: errors.length === 0, errors, warnings, properties };
}
