import { describe, expect, it } from "vitest";
import {
  buildCalendarInvite,
  buildEmptyCalendar,
  buildItineraryCalendar,
  calendarContentType,
  calendarUidForSession,
  inspectIcs,
  itineraryUidForSession,
  unfoldIcs,
  type CalendarInviteInput,
} from "@/lib/ics";

const STAMP = new Date("2026-05-01T12:00:00Z");

function baseInput(overrides: Partial<CalendarInviteInput> = {}): CalendarInviteInput {
  return {
    uid: calendarUidForSession("sess-1"),
    sequence: 0,
    method: "REQUEST",
    title: "Retrieval that survives production traffic",
    description: "A practical pattern for retrieval under load.",
    timeZone: "America/Los_Angeles",
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:45",
    organizer: { name: "AI Engineer Summit 2026", email: "hello@greenroom.dev" },
    attendees: [{ name: "Priya Raman", email: "priya@example.com" }],
    stamp: STAMP,
    ...overrides,
  };
}

/** Property values, unfolded, for one property name. */
function values(content: string, name: string): string[] {
  return unfoldIcs(content)
    .filter((line) => new RegExp(`^${name}[;:]`, "i").test(line))
    .map((line) => line.slice(line.search(/[;:]/) + 1));
}

/** Whole content lines (params included) for one property name. */
function lines(content: string, name: string): string[] {
  return unfoldIcs(content).filter((line) => new RegExp(`^${name}[;:]`, "i").test(line));
}

describe("calendarUidForSession", () => {
  it("is stable and derived from the session id, so it needs no storage", () => {
    expect(calendarUidForSession("sess-1")).toBe("session-sess-1@greenroom.dev");
    expect(calendarUidForSession("sess-1")).toBe(calendarUidForSession("sess-1"));
    expect(calendarUidForSession("sess-2")).not.toBe(calendarUidForSession("sess-1"));
  });

  it("honours a configured domain", () => {
    expect(calendarUidForSession("sess-1", "cfp.example.org")).toBe(
      "session-sess-1@cfp.example.org",
    );
  });
});

describe("calendarContentType", () => {
  it("carries the mandatory method parameter (RFC 6047 §2.4)", () => {
    expect(calendarContentType("REQUEST")).toBe("text/calendar; charset=utf-8; method=REQUEST");
    expect(calendarContentType("CANCEL")).toBe("text/calendar; charset=utf-8; method=CANCEL");
  });
});

describe("buildCalendarInvite — REQUEST structure", () => {
  const invite = buildCalendarInvite(baseInput());

  it("is a well-formed iTIP REQUEST", () => {
    const inspection = inspectIcs(invite.content, { method: "REQUEST" });
    expect(inspection.errors).toEqual([]);
    expect(inspection.ok).toBe(true);
  });

  it("uses CRLF line endings (RFC 5545 §3.1)", () => {
    expect(invite.content).toContain("\r\n");
    expect(/(?<!\r)\n/.test(invite.content)).toBe(false);
  });

  it("declares METHOD:REQUEST at the calendar level and in the MIME type", () => {
    expect(values(invite.content, "METHOD")).toEqual(["REQUEST"]);
    expect(invite.contentType).toBe("text/calendar; charset=utf-8; method=REQUEST");
    expect(invite.filename.endsWith(".ics")).toBe(true);
  });

  it("uses the supplied send time as DTSTAMP", () => {
    expect(values(invite.content, "DTSTAMP")).toEqual(["20260501T120000Z"]);
  });

  it("names an ORGANIZER and an attendee who is asked to reply", () => {
    expect(lines(invite.content, "ORGANIZER")[0]).toMatch(/mailto:hello@greenroom\.dev/i);
    const attendee = lines(invite.content, "ATTENDEE")[0];
    expect(attendee).toMatch(/mailto:priya@example\.com/i);
    expect(attendee).toContain("PARTSTAT=");
    expect(attendee).toContain("NEEDS-ACTION");
    expect(attendee).toContain("RSVP=TRUE");
  });

  it("puts the session title in SUMMARY and the human time in DESCRIPTION", () => {
    expect(values(invite.content, "SUMMARY")).toEqual([
      "Retrieval that survives production traffic",
    ]);
    expect(values(invite.content, "DESCRIPTION")[0]).toContain("10:00 AM – 10:45 AM PDT");
  });
});

describe("buildCalendarInvite — time zone handling", () => {
  it("emits UTC instants rather than a TZID it cannot define", () => {
    const invite = buildCalendarInvite(baseInput());
    // 10:00 in Los Angeles in June is 17:00 UTC.
    expect(values(invite.content, "DTSTART")).toEqual(["20260616T170000Z"]);
    expect(values(invite.content, "DTEND")).toEqual(["20260616T174500Z"]);
    expect(invite.startsAt.toISOString()).toBe("2026-06-16T17:00:00.000Z");
    expect(invite.endsAt.toISOString()).toBe("2026-06-16T17:45:00.000Z");
  });

  it("never writes a TZID parameter without a VTIMEZONE component", () => {
    const invite = buildCalendarInvite(baseInput());
    expect(invite.content).not.toContain("TZID");
    expect(invite.content).not.toContain("BEGIN:VTIMEZONE");
  });

  it("moves the UTC instant when the event zone changes, wall clock unchanged", () => {
    const berlin = buildCalendarInvite(baseInput({ timeZone: "Europe/Berlin" }));
    expect(values(berlin.content, "DTSTART")).toEqual(["20260616T080000Z"]);
  });

  it("repeats the local wall clock in the description so it is never ambiguous", () => {
    const invite = buildCalendarInvite(baseInput());
    expect(values(invite.content, "DESCRIPTION")[0]).toContain("PDT");
  });
});

describe("buildCalendarInvite — LOCATION", () => {
  it("omits LOCATION entirely when nothing is known yet", () => {
    const invite = buildCalendarInvite(baseInput({ location: null }));
    expect(values(invite.content, "LOCATION")).toEqual([]);
  });

  it("carries the room once it is assigned", () => {
    const invite = buildCalendarInvite(baseInput({ location: "Main Stage, Moscone West" }));
    // RFC 5545 §3.3.11 escapes commas inside TEXT values.
    expect(values(invite.content, "LOCATION")[0]).toBe("Main Stage\\, Moscone West");
  });
});

describe("buildCalendarInvite — updates", () => {
  const first = buildCalendarInvite(baseInput());
  const second = buildCalendarInvite(
    baseInput({ sequence: 1, location: "Community Hall", startTime: "11:00", endTime: "11:45" }),
  );

  it("keeps the same UID so clients update in place instead of duplicating", () => {
    expect(values(second.content, "UID")).toEqual(values(first.content, "UID"));
    expect(second.uid).toBe(first.uid);
  });

  it("bumps SEQUENCE so the later object wins (RFC 5546 §2.1.4)", () => {
    expect(values(first.content, "SEQUENCE")).toEqual(["0"]);
    expect(values(second.content, "SEQUENCE")).toEqual(["1"]);
  });

  it("carries the newly assigned room and the new time", () => {
    expect(values(first.content, "LOCATION")).toEqual([]);
    expect(values(second.content, "LOCATION")).toEqual(["Community Hall"]);
    expect(values(second.content, "DTSTART")).toEqual(["20260616T180000Z"]);
  });
});

describe("buildCalendarInvite — CANCEL", () => {
  const cancel = buildCalendarInvite(baseInput({ method: "CANCEL", sequence: 2 }));

  it("addresses the same entry with METHOD:CANCEL and a cancelled STATUS", () => {
    expect(values(cancel.content, "METHOD")).toEqual(["CANCEL"]);
    expect(values(cancel.content, "UID")).toEqual([calendarUidForSession("sess-1")]);
    expect(values(cancel.content, "STATUS")).toEqual(["CANCELLED"]);
    expect(cancel.contentType).toContain("method=CANCEL");
  });

  it("does not ask the attendee to reply to a cancellation", () => {
    expect(lines(cancel.content, "ATTENDEE")[0]).toContain("RSVP=FALSE");
  });

  it("passes validation as a CANCEL", () => {
    expect(inspectIcs(cancel.content, { method: "CANCEL" }).errors).toEqual([]);
  });
});

describe("inspectIcs", () => {
  const invite = buildCalendarInvite(baseInput());

  it("reports a method mismatch", () => {
    const inspection = inspectIcs(invite.content, { method: "CANCEL" });
    expect(inspection.ok).toBe(false);
    expect(inspection.errors.join(" ")).toMatch(/METHOD/i);
  });

  it("catches a floating DTSTART with no zone information", () => {
    const floating = invite.content.replace("DTSTART:20260616T170000Z", "DTSTART:20260616T100000");
    expect(inspectIcs(floating).errors.length).toBeGreaterThan(0);
  });

  it("catches a TZID that has no VTIMEZONE to resolve it", () => {
    const bogus = invite.content.replace(
      "DTSTART:20260616T170000Z",
      "DTSTART;TZID=America/Los_Angeles:20260616T100000",
    );
    expect(inspectIcs(bogus).errors.join(" ")).toMatch(/VTIMEZONE/i);
  });

  it("catches a missing ORGANIZER", () => {
    const orphan = unfoldIcs(invite.content)
      .filter((line) => !line.startsWith("ORGANIZER"))
      .join("\r\n");
    expect(inspectIcs(`${orphan}\r\n`).errors.join(" ")).toMatch(/ORGANIZER/i);
  });
});

describe("unfoldIcs", () => {
  it("rejoins folded content lines (RFC 5545 §3.1)", () => {
    const folded = "BEGIN:VCALENDAR\r\nDESCRIPTION:one\r\n two\r\nEND:VCALENDAR\r\n";
    expect(unfoldIcs(folded)).toEqual(["BEGIN:VCALENDAR", "DESCRIPTION:onetwo", "END:VCALENDAR"]);
  });

  it("keeps every generated line within the 75-octet limit", () => {
    const invite = buildCalendarInvite(
      baseInput({ description: "x".repeat(400), title: "y".repeat(200) }),
    );
    for (const line of invite.content.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildItineraryCalendar", () => {
  const entries = [
    {
      sessionId: "sess-1",
      title: "Retrieval that survives production traffic",
      description: "A practical pattern for retrieval under load.",
      location: "Main Stage",
      day: "2026-06-16",
      startTime: "10:00",
      endTime: "10:45",
    },
    {
      sessionId: "sess-2",
      title: "Shipping an agent into a hospital",
      description: null,
      location: null,
      day: "2026-06-17",
      startTime: "14:00",
      endTime: "14:45",
    },
  ];

  function build(overrides: Partial<Parameters<typeof buildItineraryCalendar>[0]> = {}) {
    return buildItineraryCalendar({
      timeZone: "America/Los_Angeles",
      entries,
      calendarName: "AI Engineer Summit 2026 — my schedule",
      filenameBase: "ai-engineer-summit-2026-my-schedule",
      stamp: STAMP,
      ...overrides,
    });
  }

  it("wraps every starred session in one calendar object", () => {
    const { content } = build();
    const unfolded = unfoldIcs(content);

    expect(unfolded[0]).toBe("BEGIN:VCALENDAR");
    expect(unfolded[unfolded.length - 1]).toBe("END:VCALENDAR");
    expect(unfolded.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
    expect(values(content, "SUMMARY")).toEqual([
      "Retrieval that survives production traffic",
      "Shipping an agent into a hospital",
    ]);
    expect(values(content, "VERSION")).toEqual(["2.0"]);
  });

  it("is a plain calendar file, not an iTIP message", () => {
    const { content, contentType, filename } = build();

    // PUBLISH, not REQUEST: RFC 5546 §3.2.1 is exactly "here is an event",
    // with no organizer to RSVP to and no attendee list.
    expect(values(content, "METHOD")).toEqual(["PUBLISH"]);
    expect(values(content, "ORGANIZER")).toEqual([]);
    expect(values(content, "ATTENDEE")).toEqual([]);
    expect(contentType).toBe("text/calendar; charset=utf-8");
    expect(contentType).not.toContain("method=");
    expect(filename).toBe("ai-engineer-summit-2026-my-schedule.ics");
  });

  it("emits UTC instants derived from the event's zone, never a bare TZID", () => {
    const { content } = build();

    // 10:00 PDT (UTC-7) on June 16 is 17:00Z.
    expect(lines(content, "DTSTART")).toEqual(["DTSTART:20260616T170000Z", "DTSTART:20260617T210000Z"]);
    expect(lines(content, "DTEND")).toEqual(["DTEND:20260616T174500Z", "DTEND:20260617T214500Z"]);
    expect(inspectIcs(content).errors).not.toContain(
      "DTSTART is floating local time (no Z, no TZID) — it will render in the reader's zone",
    );
  });

  it("keeps the room as LOCATION and repeats the local time in the description", () => {
    const { content } = build();

    expect(values(content, "LOCATION")).toEqual(["Main Stage"]);
    expect(values(content, "DESCRIPTION")[0]).toContain("A practical pattern for retrieval");
    expect(values(content, "DESCRIPTION")[0]).toContain("10:00 AM");
    // The second session has no abstract — the description is just the when.
    expect(values(content, "DESCRIPTION")[1]).toContain("2:00 PM");
  });

  // spec.md "Public program depth": every session surface, feeds included,
  // carries speaker name/title/company. The labels arrive pre-rendered from
  // src/domain/program.ts `speakerAffiliationLabel`.
  it("lists the session's speakers in the description", () => {
    const { content } = build({
      entries: [
        {
          ...entries[0],
          speakers: ["Priya Raman — Staff Engineer, Northwind", "Ada Lovelace"],
        },
      ],
    });

    const [description] = values(content, "DESCRIPTION");
    // TEXT escaping (RFC 5545 §3.3.11) survives: the affiliation's comma and
    // the line breaks between speakers are escape sequences, never raw.
    expect(description).toContain(
      "Speakers:\\nPriya Raman — Staff Engineer\\, Northwind\\nAda Lovelace",
    );
    expect(description).not.toMatch(/[\r\n]/);
    // The abstract and the local time still bracket it.
    expect(description).toContain("A practical pattern for retrieval");
    expect(description).toContain("10:00 AM");
  });

  it("uses the singular heading for a one-speaker session", () => {
    const { content } = build({
      entries: [{ ...entries[0], speakers: ["Ada Lovelace"] }],
    });
    expect(values(content, "DESCRIPTION")[0]).toContain("Speaker:\\nAda Lovelace");
  });

  it("says nothing about speakers when a session has none", () => {
    const { content } = build({ entries: [{ ...entries[0], speakers: [] }] });
    expect(values(content, "DESCRIPTION")[0]).not.toContain("Speaker");
  });

  it("folds a long speaker list without splitting a code point", () => {
    const { content } = build({
      entries: [
        {
          ...entries[0],
          speakers: [
            "Ana Sofía Fernández — Principal Researcher, Instituto Nacional de Investigación",
            "Priya Raman — Staff Engineer, Northwind Logistics International",
          ],
        },
      ],
    });

    for (const line of content.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(values(content, "DESCRIPTION")[0]).toContain("Ana Sofía Fernández");
  });

  it("uses itinerary UIDs, so importing never collides with a speaker invite", () => {
    const { content } = build();

    expect(values(content, "UID")).toEqual([
      "itinerary-sess-1@greenroom.dev",
      "itinerary-sess-2@greenroom.dev",
    ]);
    expect(itineraryUidForSession("sess-1")).not.toBe(calendarUidForSession("sess-1"));
  });

  it("re-exporting the same session addresses the same calendar entry", () => {
    const first = build({ entries: [entries[0]] });
    const second = build();

    expect(values(second.content, "UID")[0]).toBe(values(first.content, "UID")[0]);
  });

  it("refuses to build an empty calendar", () => {
    expect(() => build({ entries: [] })).toThrow(/no sessions/i);
  });
});

describe("buildEmptyCalendar", () => {
  it("returns a valid empty PUBLISH calendar for unpublished feeds", () => {
    const calendar = buildEmptyCalendar({
      calendarName: "AI Engineer Summit 2026 — schedule",
      filenameBase: "ai-engineer-summit-2026-schedule",
    });

    expect(unfoldIcs(calendar.content)).toEqual(
      expect.arrayContaining([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:AI Engineer Summit 2026 — schedule",
        "END:VCALENDAR",
      ]),
    );
    expect(calendar.content).not.toContain("BEGIN:VEVENT");
    expect(calendar.contentType).toBe("text/calendar; charset=utf-8");
    expect(calendar.filename).toBe("ai-engineer-summit-2026-schedule.ics");
  });
});
