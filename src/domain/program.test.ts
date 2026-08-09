import { describe, expect, it } from "vitest";
import { inspectIcs, unfoldIcs, buildItineraryCalendar } from "@/lib/ics";
import {
  ANY_FACET,
  buildGallery,
  buildProgramFeed,
  buildSchedule,
  compareBySurname,
  countScheduleSessions,
  filterScheduleDays,
  filterSpeakers,
  flattenSchedule,
  foldText,
  gallerySessions,
  isPubliclyVisible,
  itinerarySessions,
  itineraryStorageKey,
  parseStarredIds,
  resolveFeedAssetUrl,
  scheduleFacetOptions,
  scheduleFeedEntries,
  scheduleSessions,
  sessionFormatLabel,
  sessionMatchesFilters,
  sessionMatchesQuery,
  speakerAffiliationLabel,
  speakerMatchesQuery,
  surnameKey,
  toggleStarred,
  type GallerySpeaker,
  type ProgramPerson,
  type ScheduleDay,
  type ScheduleSessionView,
  type SessionWithSpeakers,
} from "@/domain/program";

/** A confirmed, scheduled session with sensible defaults, overridable per
 * test — mirrors the fixture builder in scheduling.test.ts. */
function session(
  overrides: Partial<SessionWithSpeakers> & { id: string },
): SessionWithSpeakers {
  return {
    eventId: "evt-1",
    title: overrides.id,
    description: null,
    submissionId: null,
    trackId: null,
    roomId: null,
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:30",
    status: "confirmed",
    speakerIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function person(
  overrides: Partial<ProgramPerson> & { id: string; name: string },
): ProgramPerson {
  return {
    title: null,
    company: null,
    bio: null,
    headshotUrl: null,
    ...overrides,
  };
}

describe("isPubliclyVisible / gallerySessions / scheduleSessions", () => {
  it("only confirmed sessions are publicly visible", () => {
    expect(isPubliclyVisible({ status: "confirmed" })).toBe(true);
    expect(isPubliclyVisible({ status: "draft" })).toBe(false);
    expect(isPubliclyVisible({ status: "cancelled" })).toBe(false);
  });

  it("gallery keeps confirmed sessions whether or not they're scheduled", () => {
    const scheduled = session({ id: "a", status: "confirmed" });
    const unscheduled = session({
      id: "b",
      status: "confirmed",
      day: null,
      startTime: null,
      endTime: null,
    });
    const cancelled = session({ id: "c", status: "cancelled" });
    const draft = session({ id: "d", status: "draft" });

    expect(gallerySessions([scheduled, unscheduled, cancelled, draft])).toEqual(
      [scheduled, unscheduled],
    );
  });

  it("schedule keeps only confirmed sessions that are actually placed", () => {
    const scheduled = session({ id: "a", status: "confirmed" });
    const unscheduled = session({
      id: "b",
      status: "confirmed",
      day: null,
      startTime: null,
      endTime: null,
    });
    const cancelled = session({
      id: "c",
      status: "cancelled",
      day: "2026-06-16",
      startTime: "11:00",
      endTime: "11:30",
    });
    const partiallyPlaced = session({
      id: "d",
      status: "confirmed",
      startTime: null,
    });

    expect(
      scheduleSessions([scheduled, unscheduled, cancelled, partiallyPlaced]),
    ).toEqual([scheduled]);
  });
});

describe("buildGallery", () => {
  it("dedups a speaker across multiple accepted talks onto one card, in running order", () => {
    const priya = person({ id: "u1", name: "Priya Raman" });
    const sessions = [
      // Deliberately out of order, and the later one listed first.
      session({
        id: "s2",
        title: "A second talk",
        speakerIds: ["u1"],
        startTime: "14:00",
        endTime: "14:30",
      }),
      session({ id: "s1", title: "Retrieval at scale", speakerIds: ["u1"] }),
    ];

    const gallery = buildGallery(sessions, new Map([["u1", priya]]));

    expect(gallery).toHaveLength(1);
    expect(gallery[0].talks.map((t) => t.title)).toEqual([
      "Retrieval at scale",
      "A second talk",
    ]);
  });

  it("puts a speaker's unscheduled talks after their placed ones", () => {
    const priya = person({ id: "u1", name: "Priya Raman" });
    const sessions = [
      session({
        id: "s-parked",
        title: "Still in the parking lot",
        speakerIds: ["u1"],
        day: null,
        startTime: null,
        endTime: null,
      }),
      session({ id: "s-placed", title: "On the grid", speakerIds: ["u1"] }),
    ];

    const gallery = buildGallery(sessions, new Map([["u1", priya]]));

    expect(gallery[0].talks.map((t) => t.title)).toEqual([
      "On the grid",
      "Still in the parking lot",
    ]);
  });

  it("carries each talk's day, time, room and track for the speaker detail view", () => {
    const luis = person({ id: "u1", name: "Luis Fernández" });
    const sessions = [
      session({
        id: "s1",
        title: "Shipping an agent into a hospital",
        speakerIds: ["u1"],
        trackId: "t1",
        roomId: "r1",
      }),
    ];

    const [speaker] = buildGallery(sessions, new Map([["u1", luis]]), {
      trackById: new Map([["t1", { name: "Agents & Tool Use" }]]),
      roomById: new Map([["r1", { name: "Main Stage" }]]),
    });

    expect(speaker.talks[0]).toMatchObject({
      day: "2026-06-16",
      startTime: "10:00",
      endTime: "10:30",
      roomName: "Main Stage",
      trackName: "Agents & Tool Use",
    });
  });

  it("excludes speakers whose only sessions are cancelled or unscheduled per scope, keeps unscheduled", () => {
    const hannah = person({ id: "u2", name: "Hannah Kim" });
    const cancelledSpeaker = person({ id: "u3", name: "Cancelled Speaker" });

    const sessions = [
      session({
        id: "s3",
        title: "Evals you'll actually keep running",
        speakerIds: ["u2"],
        day: null,
        startTime: null,
        endTime: null,
      }),
      session({
        id: "s4",
        title: "Stood down talk",
        speakerIds: ["u3"],
        status: "cancelled",
      }),
    ];

    const people = new Map([
      ["u2", hannah],
      ["u3", cancelledSpeaker],
    ]);
    const gallery = buildGallery(sessions, people);

    expect(gallery.map((g) => g.name)).toEqual(["Hannah Kim"]);
  });

  it("sorts speakers by surname and skips ids missing from the people map", () => {
    const zed = person({ id: "u-z", name: "Zed Ng" });
    const sessions = [
      session({ id: "s5", title: "Talk Z", speakerIds: ["u-z"] }),
      session({ id: "s6", title: "Talk missing", speakerIds: ["u-ghost"] }),
      session({ id: "s7", title: "Talk A", speakerIds: ["u-a"] }),
    ];
    const anna = person({ id: "u-a", name: "Anna Alvarez" });

    const gallery = buildGallery(
      sessions,
      new Map([
        ["u-z", zed],
        ["u-a", anna],
      ]),
    );

    expect(gallery.map((g) => g.name)).toEqual(["Anna Alvarez", "Zed Ng"]);
  });
});

describe("buildSchedule", () => {
  const lookups = {
    trackById: new Map([["t1", { name: "AI Engineering", color: "#0e7490" }]]),
    roomById: new Map([
      ["r1", { name: "Main Stage" }],
      ["r2", { name: "Workshop A" }],
    ]),
    speakerById: new Map([
      [
        "u1",
        { name: "Priya Raman", title: "Staff Engineer", company: "Northwind" },
      ],
      ["u2", { name: "Tom Beckett", title: null, company: null }],
    ]),
  };

  it("groups sessions by day, in start-time order", () => {
    const sessions = [
      session({
        id: "s2",
        day: "2026-06-16",
        startTime: "14:00",
        endTime: "14:45",
      }),
      session({
        id: "s1",
        day: "2026-06-16",
        startTime: "10:00",
        endTime: "10:45",
      }),
      session({
        id: "s3",
        day: "2026-06-17",
        startTime: "09:00",
        endTime: "09:30",
      }),
    ];

    const days = buildSchedule(sessions, lookups);

    expect(days.map((d) => d.day)).toEqual(["2026-06-16", "2026-06-17"]);
    expect(days[0].slots.map((slot) => slot.sessions[0].id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("groups sessions sharing the same day and time range into one slot", () => {
    const sessions = [
      session({
        id: "s1",
        title: "Main stage keynote",
        roomId: "r1",
        trackId: "t1",
        speakerIds: ["u1"],
        startTime: "10:00",
        endTime: "10:45",
      }),
      session({
        id: "s2",
        title: "Parallel workshop",
        roomId: "r2",
        speakerIds: ["u2"],
        startTime: "10:00",
        endTime: "10:45",
      }),
    ];

    const [day] = buildSchedule(sessions, lookups);

    expect(day.slots).toHaveLength(1);
    expect(day.slots[0].sessions).toHaveLength(2);
    // Room name ordering: Main Stage before Workshop A.
    expect(day.slots[0].sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(day.slots[0].sessions[0].trackName).toBe("AI Engineering");
    expect(day.slots[0].sessions[0].speakers).toEqual([
      { name: "Priya Raman", title: "Staff Engineer", company: "Northwind" },
    ]);
  });

  it("excludes cancelled and unscheduled sessions from the schedule", () => {
    const sessions = [
      session({ id: "s1" }),
      session({ id: "s2", status: "cancelled" }),
      session({ id: "s3", day: null, startTime: null, endTime: null }),
    ];

    const days = buildSchedule(sessions, lookups);
    const allIds = days.flatMap((d) =>
      d.slots.flatMap((slot) => slot.sessions.map((s) => s.id)),
    );
    expect(allIds).toEqual(["s1"]);
  });
});

// ---------------------------------------------------------------------------
// Public program depth (spec.md "Public program depth", decisions.md D-031)
// ---------------------------------------------------------------------------

/** A bare-name schedule speaker — most tests below only care about the name
 * matching, not the affiliation. */
function scheduleSpeaker(
  name: string,
): ScheduleSessionView["speakers"][number] {
  return { name, title: null, company: null };
}

/** A schedule row with sensible defaults — the built view, not the entity. */
function view(
  overrides: Partial<ScheduleSessionView> & { id: string },
): ScheduleSessionView {
  return {
    title: overrides.id,
    description: null,
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:30",
    trackName: null,
    trackColor: null,
    roomName: null,
    formatLabel: "30-minute talk",
    speakers: [],
    ...overrides,
  };
}

const RETRIEVAL = view({
  id: "s1",
  title: "Retrieval that survives production traffic",
  day: "2026-06-16",
  startTime: "10:00",
  endTime: "10:45",
  trackName: "AI Engineering",
  roomName: "Main Stage",
  formatLabel: "45-minute talk",
  speakers: [scheduleSpeaker("Priya Raman")],
});
const INFERENCE = view({
  id: "s2",
  title: "Cutting inference spend by 80%",
  day: "2026-06-16",
  startTime: "11:00",
  endTime: "11:30",
  trackName: "AI Engineering",
  roomName: "Community Hall",
  speakers: [scheduleSpeaker("Tom Beckett")],
});
const HOSPITAL = view({
  id: "s3",
  title: "Shipping an agent into a hospital",
  day: "2026-06-17",
  startTime: "14:00",
  endTime: "14:45",
  trackName: "Agents & Tool Use",
  roomName: "Main Stage",
  formatLabel: "45-minute talk",
  speakers: [scheduleSpeaker("Aisha Nwosu"), scheduleSpeaker("Luis Fernández")],
});

/** Two days, three sessions, mixed tracks/rooms/formats. */
const DAYS: ScheduleDay[] = [
  {
    day: "2026-06-16",
    slots: [
      { startTime: "10:00", endTime: "10:45", sessions: [RETRIEVAL] },
      { startTime: "11:00", endTime: "11:30", sessions: [INFERENCE] },
    ],
  },
  {
    day: "2026-06-17",
    slots: [{ startTime: "14:00", endTime: "14:45", sessions: [HOSPITAL] }],
  },
];

describe("foldText / surnameKey / compareBySurname", () => {
  it("folds case and accents so an ASCII query still matches", () => {
    expect(foldText("Luis Fernández")).toBe("luis fernandez");
    expect(foldText("  Jae-won PARK ")).toBe("jae-won park");
  });

  it("takes the last name part as the sort key, ignoring honorifics", () => {
    expect(surnameKey("Priya Raman")).toBe("raman");
    expect(surnameKey("Jae-won Park")).toBe("park");
    expect(surnameKey("Luis Fernández")).toBe("fernandez");
    expect(surnameKey("Ada Lovelace Jr.")).toBe("lovelace");
    expect(surnameKey("Cher")).toBe("cher");
  });

  it("orders a directory alphabetically by surname, not by first name", () => {
    const names = [
      "Priya Raman",
      "Tom Beckett",
      "Luis Fernández",
      "Jae-won Park",
      "Sofia Rossi",
    ];
    const sorted = names.map((name) => ({ name })).sort(compareBySurname);
    expect(sorted.map((s) => s.name)).toEqual([
      "Tom Beckett",
      "Luis Fernández",
      "Jae-won Park",
      "Priya Raman",
      "Sofia Rossi",
    ]);
  });
});

describe("sessionFormatLabel", () => {
  it("names the format from the placed duration, in the CFP's own vocabulary", () => {
    expect(sessionFormatLabel("10:00", "10:30")).toBe("30-minute talk");
    expect(sessionFormatLabel("10:00", "10:45")).toBe("45-minute talk");
    expect(sessionFormatLabel("13:00", "14:30")).toBe("90-minute workshop");
  });
});

describe("speakerAffiliationLabel", () => {
  it('renders "Name — Title, Company" when both are filled in', () => {
    expect(
      speakerAffiliationLabel({
        name: "Priya Raman",
        title: "Staff Engineer",
        company: "Northwind",
      }),
    ).toBe("Priya Raman — Staff Engineer, Northwind");
  });

  it("drops the missing half rather than a stray separator", () => {
    expect(
      speakerAffiliationLabel({
        name: "Tom Beckett",
        title: "Founder",
        company: null,
      }),
    ).toBe("Tom Beckett — Founder");
    expect(
      speakerAffiliationLabel({
        name: "Tom Beckett",
        title: null,
        company: "Northwind",
      }),
    ).toBe("Tom Beckett — Northwind");
  });

  it("falls back to the bare name when neither title nor company is set", () => {
    expect(
      speakerAffiliationLabel({
        name: "Priya Raman",
        title: null,
        company: null,
      }),
    ).toBe("Priya Raman");
  });
});

describe("sessionMatchesQuery", () => {
  it("matches session titles", () => {
    expect(sessionMatchesQuery(RETRIEVAL, "retrieval")).toBe(true);
    expect(sessionMatchesQuery(RETRIEVAL, "hospital")).toBe(false);
  });

  it("matches speaker names, which is the whole point of a programme search", () => {
    expect(sessionMatchesQuery(RETRIEVAL, "priya")).toBe(true);
    expect(sessionMatchesQuery(RETRIEVAL, "Raman")).toBe(true);
    expect(sessionMatchesQuery(HOSPITAL, "nwosu")).toBe(true);
    // A co-presenter counts too.
    expect(sessionMatchesQuery(HOSPITAL, "luis")).toBe(true);
  });

  it("ignores accents so 'Fernandez' finds 'Fernández'", () => {
    expect(sessionMatchesQuery(HOSPITAL, "fernandez")).toBe(true);
  });

  it("ANDs multiple terms without requiring them to be adjacent", () => {
    expect(sessionMatchesQuery(RETRIEVAL, "priya retrieval")).toBe(true);
    expect(sessionMatchesQuery(RETRIEVAL, "priya hospital")).toBe(false);
  });

  it("an empty or whitespace query matches everything", () => {
    expect(sessionMatchesQuery(RETRIEVAL, "")).toBe(true);
    expect(sessionMatchesQuery(RETRIEVAL, "   ")).toBe(true);
  });
});

describe("sessionMatchesFilters / filterScheduleDays", () => {
  it("an unset facet never narrows anything", () => {
    expect(sessionMatchesFilters(RETRIEVAL, {})).toBe(true);
    expect(
      sessionMatchesFilters(RETRIEVAL, {
        track: ANY_FACET,
        room: ANY_FACET,
        format: ANY_FACET,
      }),
    ).toBe(true);
  });

  it("filters by track, room and format", () => {
    expect(sessionMatchesFilters(RETRIEVAL, { track: "AI Engineering" })).toBe(
      true,
    );
    expect(
      sessionMatchesFilters(RETRIEVAL, { track: "Agents & Tool Use" }),
    ).toBe(false);
    expect(sessionMatchesFilters(INFERENCE, { room: "Community Hall" })).toBe(
      true,
    );
    expect(sessionMatchesFilters(INFERENCE, { room: "Main Stage" })).toBe(
      false,
    );
    expect(sessionMatchesFilters(INFERENCE, { format: "30-minute talk" })).toBe(
      true,
    );
    expect(sessionMatchesFilters(RETRIEVAL, { format: "30-minute talk" })).toBe(
      false,
    );
  });

  it("drops slots and whole days that no longer hold anything", () => {
    const narrowed = filterScheduleDays(DAYS, { track: "Agents & Tool Use" });
    expect(narrowed.map((d) => d.day)).toEqual(["2026-06-17"]);
    expect(countScheduleSessions(narrowed)).toBe(1);
  });

  it("a speaker-name search narrows the schedule and the count with it", () => {
    expect(countScheduleSessions(DAYS)).toBe(3);
    const narrowed = filterScheduleDays(DAYS, { query: "beckett" });
    expect(flattenSchedule(narrowed).map((s) => s.id)).toEqual(["s2"]);
    expect(countScheduleSessions(narrowed)).toBe(1);
  });

  it("a query matching nothing leaves no days at all", () => {
    expect(filterScheduleDays(DAYS, { query: "quantum" })).toEqual([]);
  });
});

describe("scheduleFacetOptions", () => {
  it("offers only the values actually on the schedule", () => {
    expect(scheduleFacetOptions(DAYS)).toEqual({
      tracks: ["Agents & Tool Use", "AI Engineering"],
      rooms: ["Community Hall", "Main Stage"],
      formats: ["30-minute talk", "45-minute talk"],
    });
  });
});

describe("personal itinerary", () => {
  it("namespaces stored selections per event", () => {
    expect(itineraryStorageKey("ai-engineer-summit-2026")).toBe(
      "greenroom:itinerary:ai-engineer-summit-2026",
    );
  });

  it("lists exactly the starred sessions, in the order they happen", () => {
    // Starred out of order, and across two days.
    const mine = itinerarySessions(DAYS, ["s3", "s2"]);
    expect(mine.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("silently drops ids that are no longer on the public schedule", () => {
    expect(
      itinerarySessions(DAYS, ["s1", "cancelled-since"]).map((s) => s.id),
    ).toEqual(["s1"]);
    expect(itinerarySessions(DAYS, [])).toEqual([]);
  });

  it("toggling adds then removes, leaving the input untouched", () => {
    const empty: string[] = [];
    const one = toggleStarred(empty, "s1");
    expect(one).toEqual(["s1"]);
    expect(empty).toEqual([]);
    expect(toggleStarred(one, "s2")).toEqual(["s1", "s2"]);
    expect(toggleStarred(one, "s1")).toEqual([]);
  });

  it("survives a missing, corrupt or hand-edited stored value", () => {
    expect(parseStarredIds(null)).toEqual([]);
    expect(parseStarredIds("")).toEqual([]);
    expect(parseStarredIds("not json")).toEqual([]);
    expect(parseStarredIds('{"s1":true}')).toEqual([]);
    expect(parseStarredIds('["s1", 7, null, "s2"]')).toEqual(["s1", "s2"]);
  });
});

describe("speakerMatchesQuery / filterSpeakers", () => {
  const speaker = (
    overrides: Partial<GallerySpeaker> & { id: string; name: string },
  ) =>
    ({
      title: null,
      company: null,
      bio: null,
      headshotUrl: null,
      talks: [],
      ...overrides,
    }) as GallerySpeaker;

  const lineup = [
    speaker({ id: "u1", name: "Tom Beckett", company: "Northwind" }),
    speaker({ id: "u2", name: "Luis Fernández", title: "Staff Engineer" }),
    speaker({ id: "u3", name: "Priya Raman" }),
  ];

  it("matches on name, including accents typed as plain ASCII", () => {
    expect(speakerMatchesQuery(lineup[1], "fernandez")).toBe(true);
    expect(speakerMatchesQuery(lineup[1], "luis")).toBe(true);
    expect(speakerMatchesQuery(lineup[1], "raman")).toBe(false);
  });

  it("also matches title and company, and a speaker missing both still searches by name", () => {
    expect(speakerMatchesQuery(lineup[0], "northwind")).toBe(true);
    expect(speakerMatchesQuery(lineup[1], "staff")).toBe(true);
    expect(speakerMatchesQuery(lineup[2], "priya")).toBe(true);
  });

  it("narrows the gallery, preserving its order", () => {
    expect(filterSpeakers(lineup, "an").map((s) => s.name)).toEqual([
      "Luis Fernández",
      "Priya Raman",
    ]);
    expect(filterSpeakers(lineup, "")).toEqual(lineup);
    expect(filterSpeakers(lineup, "nobody")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Public JSON feed (decisions.md D-040)
// ---------------------------------------------------------------------------

describe("buildProgramFeed", () => {
  const lookups = {
    trackById: new Map([["t1", { name: "AI Engineering", color: "#0e7490" }]]),
    roomById: new Map([["r1", { name: "Main Stage" }]]),
    speakerById: new Map([
      ["u1", { name: "Priya Raman", title: null, company: null }],
    ]),
  };
  const event = {
    name: "AI Engineer Summit 2026",
    timezone: "America/Los_Angeles",
  };

  it("only carries confirmed, scheduled sessions — draft, unscheduled, and cancelled are excluded", () => {
    const scheduled = session({
      id: "s1",
      title: "Retrieval at scale",
      trackId: "t1",
      roomId: "r1",
      speakerIds: ["u1"],
    });
    const draft = session({ id: "s2", status: "draft" });
    const cancelled = session({ id: "s3", status: "cancelled" });
    const unscheduled = session({
      id: "s4",
      status: "confirmed",
      day: null,
      startTime: null,
      endTime: null,
    });

    const days = buildSchedule(
      [scheduled, draft, cancelled, unscheduled],
      lookups,
    );
    const gallery = buildGallery(
      [scheduled, draft, cancelled, unscheduled],
      new Map(),
    );

    const feed = buildProgramFeed(event, days, gallery);

    expect(feed.sessions).toHaveLength(1);
    expect(feed.sessions[0]).toEqual({
      title: "Retrieval at scale",
      description: null,
      day: "2026-06-16",
      startTime: "10:00",
      endTime: "10:30",
      roomName: "Main Stage",
      trackName: "AI Engineering",
      // Both the legacy bare-name array (unchanged, for existing feed
      // consumers) and the richer speakers array (name + title + company).
      speakerNames: ["Priya Raman"],
      speakers: [{ name: "Priya Raman", title: null, company: null }],
    });
  });

  it("carries resolved speaker fields and no internal id or email", () => {
    const priya = person({
      id: "u1",
      name: "Priya Raman",
      title: "Staff Engineer",
      company: "Northwind",
      bio: "Builds retrieval systems.",
      headshotUrl: "/files/uploads/priya.jpg",
    });
    const scheduled = session({ id: "s1", speakerIds: ["u1"] });
    const days = buildSchedule([scheduled], lookups);
    const gallery = buildGallery([scheduled], new Map([["u1", priya]]));

    const feed = buildProgramFeed(event, days, gallery);

    expect(feed.speakers).toEqual([
      {
        name: "Priya Raman",
        title: "Staff Engineer",
        company: "Northwind",
        bio: "Builds retrieval systems.",
        headshotUrl: "/files/uploads/priya.jpg",
      },
    ]);
    // No `id`, no `email` — check the exact key set, not just the values.
    expect(Object.keys(feed.speakers[0]).sort()).toEqual([
      "bio",
      "company",
      "headshotUrl",
      "name",
      "title",
    ]);
    expect(JSON.stringify(feed)).not.toMatch(/"id"|@|email/i);
  });

  it("carries the event's name and timezone, nothing else", () => {
    const feed = buildProgramFeed(event, [], []);
    expect(feed.event).toEqual({
      name: "AI Engineer Summit 2026",
      timezone: "America/Los_Angeles",
    });
  });
});

describe("resolveFeedAssetUrl", () => {
  it("resolves a relative /files/ path against the given origin", () => {
    expect(
      resolveFeedAssetUrl("https://example.com", "/files/uploads/priya.jpg"),
    ).toBe("https://example.com/files/uploads/priya.jpg");
  });

  it("leaves an already-absolute URL untouched", () => {
    expect(
      resolveFeedAssetUrl(
        "https://example.com",
        "https://cdn.example/priya.jpg",
      ),
    ).toBe("https://cdn.example/priya.jpg");
  });

  it("passes null through", () => {
    expect(resolveFeedAssetUrl("https://example.com", null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Public iCal feed (decisions.md D-040)
// ---------------------------------------------------------------------------

describe("scheduleFeedEntries", () => {
  const lookups = {
    trackById: new Map(),
    roomById: new Map([["r1", { name: "Main Stage" }]]),
    speakerById: new Map(),
  };

  it("maps the public schedule to buildItineraryCalendar's entry shape", () => {
    const scheduled = session({
      id: "s1",
      title: "Retrieval at scale",
      description: "A practical pattern for retrieval under load.",
      roomId: "r1",
    });
    const days = buildSchedule([scheduled], lookups);

    expect(scheduleFeedEntries(days)).toEqual([
      {
        sessionId: "s1",
        title: "Retrieval at scale",
        description: "A practical pattern for retrieval under load.",
        location: "Main Stage",
        day: "2026-06-16",
        startTime: "10:00",
        endTime: "10:30",
      },
    ]);
  });

  it("produces a valid iCalendar object for the whole public schedule (RFC 5545/5546)", () => {
    const days = buildSchedule(
      [
        session({ id: "s1", title: "Retrieval at scale", roomId: "r1" }),
        session({ id: "s2", title: "Shipping an agent", day: "2026-06-17" }),
      ],
      lookups,
    );

    const calendar = buildItineraryCalendar({
      timeZone: "America/Los_Angeles",
      calendarName: "AI Engineer Summit 2026 — schedule",
      filenameBase: "ai-engineer-summit-2026-schedule",
      entries: scheduleFeedEntries(days),
      stamp: new Date("2026-05-01T12:00:00Z"),
    });

    expect(calendar.contentType).toBe("text/calendar; charset=utf-8");
    // A feed calendar is METHOD:PUBLISH with no ORGANIZER/ATTENDEE (see
    // src/lib/ics.ts's own buildItineraryCalendar tests), so only the
    // structural/timezone checks apply here, not inspectIcs's full REQUEST
    // checklist.
    const inspection = inspectIcs(calendar.content);
    expect(inspection.errors).not.toContain(
      "DTSTART is floating local time (no Z, no TZID) — it will render in the reader's zone",
    );
    expect(inspection.errors.join(" ")).not.toMatch(/VTIMEZONE/);
    expect(inspection.properties.VERSION).toEqual(["2.0"]);
    expect(
      unfoldIcs(calendar.content).filter((l) => l.startsWith("SUMMARY:")),
    ).toEqual(["SUMMARY:Retrieval at scale", "SUMMARY:Shipping an agent"]);
    // METHOD:PUBLISH, no ORGANIZER/ATTENDEE — this is a feed, not an invite.
    expect(calendar.content).toContain("METHOD:PUBLISH");
    expect(calendar.content).not.toContain("ORGANIZER");
    expect(calendar.content).not.toContain("ATTENDEE");
  });
});
