/**
 * iCalendar (.ics) generation — the ONLY module allowed to import the `ics`
 * npm package (decisions.md D-003, D-008). Domain code calls
 * `buildCalendarInvite()` and never sees the library's types, so swapping the
 * generator later is a one-file change.
 *
 * Design notes, all of which are load-bearing for "the invite actually works
 * in Gmail, Outlook and Apple Calendar":
 *
 * **Times are emitted in UTC, derived from the event's IANA zone.**
 * RFC 5545 §3.2.19 requires a matching `VTIMEZONE` component for every
 * `TZID` parameter, and Microsoft documents that when Outlook cannot resolve
 * a `TZID` it silently falls back to *the recipient's* local timezone
 * (MS-STANOICAL §RFC5545 3.2.19, V0032) — i.e. a 10:00 Los Angeles talk
 * becomes 10:00 wherever the speaker happens to be. `ics@3` emits no
 * `VTIMEZONE` at all, so the only correct option it offers is a UTC
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
import { createEvent, type DateArray, type EventAttributes } from "ics";
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

function toUtcDateArray(instant: Date): DateArray {
  return [
    instant.getUTCFullYear(),
    instant.getUTCMonth() + 1,
    instant.getUTCDate(),
    instant.getUTCHours(),
    instant.getUTCMinutes(),
  ];
}

function formatStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** Builds the .ics object for one session invite. */
export function buildCalendarInvite(input: CalendarInviteInput): CalendarInvite {
  const startsAt = zonedWallClockToInstant(input.day, input.startTime, input.timeZone);
  const durationMinutes = wallClockDurationMinutes(input.startTime, input.endTime);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

  const when = formatEventWhen(input.day, input.startTime, input.endTime, input.timeZone);
  const descriptionParts = [input.description?.trim(), when].filter(Boolean) as string[];

  const attributes: EventAttributes = {
    uid: input.uid,
    sequence: input.sequence,
    method: input.method,
    productId: input.productId ?? DEFAULT_PRODUCT_ID,
    title: input.title,
    description: descriptionParts.join("\n\n"),
    start: toUtcDateArray(startsAt),
    startInputType: "utc",
    startOutputType: "utc",
    end: toUtcDateArray(endsAt),
    endInputType: "utc",
    endOutputType: "utc",
    status: input.status ?? (input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"),
    // Outlook reads free/busy from this X- property rather than TRANSP.
    busyStatus: "BUSY",
    transp: "OPAQUE",
    organizer: { name: input.organizer.name ?? undefined, email: input.organizer.email },
    attendees: input.attendees.map((attendee) => ({
      name: attendee.name ?? undefined,
      email: attendee.email,
      cutype: "INDIVIDUAL" as const,
      role: attendee.role ?? "REQ-PARTICIPANT",
      partstat: attendee.partstat ?? (input.method === "CANCEL" ? "ACCEPTED" : "NEEDS-ACTION"),
      rsvp: attendee.rsvp ?? input.method === "REQUEST",
    })),
  };
  if (input.location) attributes.location = input.location;
  if (input.url) attributes.url = input.url;

  const { error, value } = createEvent(attributes);
  if (error || !value) {
    throw new Error(`Could not build calendar invite for ${input.uid}: ${error?.message}`);
  }

  // `ics` stamps DTSTAMP with the current time and offers no override; the
  // replacement below exists purely so fixtures/tests are reproducible.
  const content = input.stamp
    ? value.replace(/^DTSTAMP:.*$/m, `DTSTAMP:${formatStamp(input.stamp)}`)
    : value;

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
