import { describe, expect, it } from "vitest";
import type { ContactNote, EmailLog, PipelineCard, PipelineStageEvent } from "@/db/entities";
import type { DirectoryContact } from "@/db/repos/contacts";
import {
  activeFilterCount,
  buildContactActivity,
  computeCrmKpis,
  contactDisplayName,
  filterDirectory,
  isEmptyDirectoryFilter,
  matchesDirectoryFilter,
  normalizeDirectoryFilter,
  normalizeTagLabel,
  normalizeTagLabels,
  sortDirectoryContacts,
  topCompanies,
} from "@/domain/crm";

function contact(overrides: Partial<DirectoryContact> = {}): DirectoryContact {
  return {
    userId: "u1",
    name: "Priya Raman",
    email: "priya@example.com",
    title: "Staff Engineer",
    company: "Northwind",
    headshotUrl: null,
    tags: [],
    eventCount: 1,
    inRegistry: false,
    ...overrides,
  };
}

describe("normalizeTagLabel", () => {
  it("trims, collapses inner whitespace, and casefolds", () => {
    expect(normalizeTagLabel("  Keynote   Ready ")).toBe("keynote ready");
    expect(normalizeTagLabel("AI")).toBe("ai");
  });

  it("returns null when nothing survives", () => {
    expect(normalizeTagLabel("")).toBeNull();
    expect(normalizeTagLabel("   ")).toBeNull();
    expect(normalizeTagLabel(null)).toBeNull();
    expect(normalizeTagLabel(undefined)).toBeNull();
  });

  it("maps every spelling of one tag onto the same stored label", () => {
    const spellings = ["Keynote", "keynote", "  KEYNOTE  ", "Key note".replace(" ", "")];
    const normalized = new Set(spellings.map((raw) => normalizeTagLabel(raw)));
    expect([...normalized]).toEqual(["keynote"]);
  });

  it("caps a label so a paragraph can't become a tag", () => {
    expect(normalizeTagLabel("x".repeat(200))).toHaveLength(40);
  });
});

describe("normalizeTagLabels", () => {
  it("drops blanks, de-duplicates case variants, and sorts", () => {
    expect(normalizeTagLabels([" Keynote ", "keynote", "", null, "AI", "ai "])).toEqual([
      "ai",
      "keynote",
    ]);
  });
});

describe("normalizeDirectoryFilter", () => {
  it("drops blank fields entirely so equivalent filters compare equal", () => {
    expect(normalizeDirectoryFilter({ q: "  ", company: "", tag: "   " })).toEqual({});
    expect(normalizeDirectoryFilter(undefined)).toEqual({});
  });

  it("trims search and company but normalizes the tag like a tag", () => {
    expect(normalizeDirectoryFilter({ q: "  priya ", company: " Northwind ", tag: " AI " })).toEqual(
      { q: "priya", company: "Northwind", tag: "ai" },
    );
  });

  it("reports whether anything is being narrowed", () => {
    expect(isEmptyDirectoryFilter({})).toBe(true);
    expect(isEmptyDirectoryFilter({ q: "  " })).toBe(true);
    expect(isEmptyDirectoryFilter({ tag: "ai" })).toBe(false);
    expect(activeFilterCount({ q: "a", company: "b", tag: "" })).toBe(2);
  });
});

describe("matchesDirectoryFilter", () => {
  const priya = contact({ tags: ["ai", "keynote"] });

  it("matches everything when nothing is set", () => {
    expect(matchesDirectoryFilter(priya, {})).toBe(true);
    expect(matchesDirectoryFilter(priya, undefined)).toBe(true);
  });

  it("searches name and email, case-insensitively, as a substring", () => {
    expect(matchesDirectoryFilter(priya, { q: "RAMAN" })).toBe(true);
    expect(matchesDirectoryFilter(priya, { q: "iya@exa" })).toBe(true);
    expect(matchesDirectoryFilter(priya, { q: "beckett" })).toBe(false);
  });

  it("does not let the search box match on company or title", () => {
    expect(matchesDirectoryFilter(priya, { q: "northwind" })).toBe(false);
    expect(matchesDirectoryFilter(priya, { q: "staff" })).toBe(false);
  });

  it("matches company on an exact name or a substring of it", () => {
    expect(matchesDirectoryFilter(priya, { company: "Northwind" })).toBe(true);
    expect(matchesDirectoryFilter(priya, { company: "north" })).toBe(true);
    expect(matchesDirectoryFilter(priya, { company: "Southwind" })).toBe(false);
  });

  it("matches a tag exactly, after normalizing the needle", () => {
    expect(matchesDirectoryFilter(priya, { tag: " AI " })).toBe(true);
    expect(matchesDirectoryFilter(priya, { tag: "keynote" })).toBe(true);
    expect(matchesDirectoryFilter(priya, { tag: "ai enthusiast" })).toBe(false);
  });

  it("composes with AND: every set field has to match", () => {
    expect(matchesDirectoryFilter(priya, { q: "priya", company: "north", tag: "ai" })).toBe(true);
    expect(matchesDirectoryFilter(priya, { q: "priya", company: "north", tag: "cloud" })).toBe(
      false,
    );
    expect(matchesDirectoryFilter(priya, { q: "tom", company: "north" })).toBe(false);
  });

  it("survives contacts with nothing but an address", () => {
    const bare = contact({ name: null, title: null, company: null, userId: "u2" });
    expect(matchesDirectoryFilter(bare, { q: "priya@example.com" })).toBe(true);
    expect(matchesDirectoryFilter(bare, { company: "north" })).toBe(false);
  });
});

describe("filterDirectory", () => {
  it("keeps only the matching contacts, in the order given", () => {
    const list = [
      contact({ userId: "u1", name: "Priya Raman", tags: ["ai"] }),
      contact({ userId: "u2", name: "Tom Beckett", email: "tom@example.com", company: "Acme" }),
      contact({ userId: "u3", name: "Ada Wong", email: "ada@example.com", company: "Acme" }),
    ];
    expect(filterDirectory(list, { company: "acme" }).map((c) => c.userId)).toEqual(["u2", "u3"]);
    expect(filterDirectory(list, { tag: "ai" }).map((c) => c.userId)).toEqual(["u1"]);
  });
});

describe("sortDirectoryContacts", () => {
  it("orders by display name, case-insensitively, with the email as tie-break", () => {
    const list = [
      contact({ userId: "u1", name: "tom beckett", email: "tom@example.com" }),
      contact({ userId: "u2", name: null, email: "ada@example.com" }),
      contact({ userId: "u3", name: "Priya Raman", email: "priya@example.com" }),
      contact({ userId: "u4", name: null, email: "aaron@example.com" }),
    ];
    expect(sortDirectoryContacts(list).map((c) => c.userId)).toEqual(["u4", "u2", "u3", "u1"]);
  });

  it("does not mutate the input", () => {
    const list = [contact({ userId: "u2", name: "Zoe" }), contact({ userId: "u1", name: "Ada" })];
    sortDirectoryContacts(list);
    expect(list.map((c) => c.userId)).toEqual(["u2", "u1"]);
  });

  it("falls back to the address for a contact with no name", () => {
    expect(contactDisplayName({ name: "  ", email: "ada@example.com" })).toBe("ada@example.com");
    expect(contactDisplayName({ name: "Ada Wong", email: "ada@example.com" })).toBe("Ada Wong");
  });
});

describe("buildContactActivity", () => {
  const at = (iso: string) => new Date(iso);

  const emails: EmailLog[] = [
    {
      id: "e1",
      to: "priya@example.com",
      subject: "Your session is confirmed",
      kind: "decision",
      relatedType: null,
      relatedId: null,
      status: "sent",
      sentAt: at("2026-03-02T10:00:00Z"),
      error: null,
    },
  ];
  const stageEvents: PipelineStageEvent[] = [
    {
      id: "s1",
      cardId: "c1",
      fromStage: null,
      toStage: "identified",
      actorUserId: "admin1",
      createdAt: at("2026-03-01T09:00:00Z"),
    },
    {
      id: "s2",
      cardId: "c1",
      fromStage: "identified",
      toStage: "contacted",
      actorUserId: "admin1",
      createdAt: at("2026-03-03T09:00:00Z"),
    },
  ];
  const notes: ContactNote[] = [
    {
      id: "n1",
      userId: "u1",
      authorUserId: "admin1",
      body: "Met at the meetup.",
      createdAt: at("2026-03-02T12:00:00Z"),
    },
  ];

  it("merges all three sources newest first", () => {
    const feed = buildContactActivity({ emails, stageEvents, notes });
    expect(feed.map((item) => item.id)).toEqual(["s2", "n1", "e1", "s1"]);
    expect(feed.map((item) => item.kind)).toEqual(["stage", "note", "email", "stage"]);
  });

  it("keeps each kind's own fields", () => {
    const feed = buildContactActivity({ emails, stageEvents, notes });
    const email = feed.find((item) => item.kind === "email");
    expect(email).toMatchObject({ subject: "Your session is confirmed", status: "sent" });
    const enrol = feed.find((item) => item.kind === "stage" && item.from === null);
    expect(enrol).toMatchObject({ to: "identified", actorUserId: "admin1" });
    const note = feed.find((item) => item.kind === "note");
    expect(note).toMatchObject({ body: "Met at the meetup." });
  });

  it("orders same-instant items deterministically rather than by input order", () => {
    const sameInstant = at("2026-03-05T00:00:00Z");
    const first = buildContactActivity({
      emails: [{ ...emails[0], id: "e9", sentAt: sameInstant }],
      notes: [{ ...notes[0], id: "n9", createdAt: sameInstant }],
      stageEvents: [{ ...stageEvents[0], id: "s9", createdAt: sameInstant }],
    });
    const second = buildContactActivity({
      stageEvents: [{ ...stageEvents[0], id: "s9", createdAt: sameInstant }],
      notes: [{ ...notes[0], id: "n9", createdAt: sameInstant }],
      emails: [{ ...emails[0], id: "e9", sentAt: sameInstant }],
    });
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.map((item) => item.kind)).toEqual(["email", "note", "stage"]);
  });

  it("returns an empty feed when a contact has no history at all", () => {
    expect(buildContactActivity({})).toEqual([]);
  });
});

describe("topCompanies", () => {
  const withCompany = (company: string | null, id: string) => contact({ userId: id, company });

  it("counts descending and breaks ties alphabetically", () => {
    const list = [
      withCompany("Northwind", "u1"),
      withCompany("Northwind", "u2"),
      withCompany("Acme", "u3"),
      withCompany("Zebra", "u4"),
    ];
    expect(topCompanies(list)).toEqual([
      { company: "Northwind", count: 2 },
      { company: "Acme", count: 1 },
      { company: "Zebra", count: 1 },
    ]);
  });

  it("treats case and padding variants as one employer", () => {
    const list = [
      withCompany("Northwind", "u1"),
      withCompany("northwind", "u2"),
      withCompany("  NORTHWIND ", "u3"),
    ];
    expect(topCompanies(list)).toEqual([{ company: "Northwind", count: 3 }]);
  });

  it("ignores contacts with no company", () => {
    expect(topCompanies([withCompany(null, "u1"), withCompany("   ", "u2")])).toEqual([]);
  });

  it("caps the list at five", () => {
    const list = ["a", "b", "c", "d", "e", "f", "g"].map((name, index) =>
      withCompany(name, `u${index}`),
    );
    expect(topCompanies(list)).toHaveLength(5);
    expect(topCompanies(list).map((row) => row.company)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("computeCrmKpis", () => {
  function card(stage: PipelineCard["stage"], id: string): PipelineCard {
    return {
      id,
      userId: id,
      stage,
      score: null,
      rationale: null,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    };
  }

  const contacts = [
    contact({ userId: "u1", company: "Northwind", eventCount: 3 }),
    contact({ userId: "u2", company: "Northwind", eventCount: 2 }),
    contact({ userId: "u3", company: "Acme", eventCount: 1 }),
    contact({ userId: "u4", company: null, eventCount: 0, inRegistry: true }),
  ];

  it("rolls up every overview number in one pass", () => {
    const kpis = computeCrmKpis({
      contacts,
      totalEvents: 4,
      cards: [card("identified", "c1"), card("identified", "c2"), card("confirmed", "c3")],
    });

    expect(kpis.totalContacts).toBe(4);
    expect(kpis.totalEvents).toBe(4);
    expect(kpis.returningSpeakers).toBe(2);
    expect(kpis.pipelineTotal).toBe(3);
    expect(kpis.pipelineByStage).toEqual({
      identified: 2,
      contacted: 0,
      interested: 0,
      confirmed: 1,
      declined: 0,
    });
    expect(kpis.topCompanies).toEqual([
      { company: "Northwind", count: 2 },
      { company: "Acme", count: 1 },
    ]);
  });

  it("counts events from the org, not from the directory", () => {
    expect(computeCrmKpis({ contacts: [], totalEvents: 7, cards: [] })).toMatchObject({
      totalContacts: 0,
      totalEvents: 7,
      returningSpeakers: 0,
      pipelineTotal: 0,
    });
  });

  it("excludes a contact connected to exactly one event from returning speakers", () => {
    const kpis = computeCrmKpis({
      contacts: [contact({ userId: "u1", eventCount: 1 })],
      totalEvents: 1,
      cards: [],
    });
    expect(kpis.returningSpeakers).toBe(0);
  });
});
