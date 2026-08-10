import { describe, expect, it } from "vitest";
import {
  activeGroupId,
  buildGroups,
  filterByQuery,
  filterPeople,
  isLongList,
  LONG_LIST_THRESHOLD,
  matchesQuery,
  queryTokens,
  sameSelection,
  selectionSummary,
  toggleSelection,
  type PersonOption,
} from "./selection";

const PEOPLE: Array<PersonOption & { confirmed: boolean; pendingTasks: number }> = [
  {
    id: "u1",
    name: "Priya Raman",
    email: "priya@example.com",
    company: "Northwind Labs",
    confirmed: true,
    pendingTasks: 0,
  },
  {
    id: "u2",
    name: "Luis Fernandez",
    email: "l.fernandez@other.dev",
    company: null,
    confirmed: false,
    pendingTasks: 2,
  },
  {
    id: "u3",
    name: "Ada Lovelace",
    email: "ada@northwind.test",
    company: "Northwind Labs",
    confirmed: false,
    pendingTasks: 1,
  },
];

describe("queryTokens", () => {
  it("splits on whitespace and lowercases", () => {
    expect(queryTokens("  Priya  RAMAN ")).toEqual(["priya", "raman"]);
  });

  it("is empty for a blank query", () => {
    expect(queryTokens("   ")).toEqual([]);
  });
});

describe("matchesQuery", () => {
  it("matches substrings case-insensitively", () => {
    expect(matchesQuery(["Priya Raman", "priya@example.com"], "RAMA")).toBe(true);
  });

  it("requires every term, but across any field and in any order", () => {
    expect(matchesQuery(["Priya Raman", "priya@example.com"], "example priya")).toBe(true);
    expect(matchesQuery(["Priya Raman", "priya@example.com"], "priya northwind")).toBe(false);
  });

  it("ignores blank fields rather than matching them", () => {
    expect(matchesQuery([null, undefined, "Ada"], "ada")).toBe(true);
    expect(matchesQuery([null, "Ada"], "null")).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    expect(matchesQuery(["Ada"], "   ")).toBe(true);
  });
});

describe("filterPeople", () => {
  it("searches name, email and company", () => {
    expect(filterPeople(PEOPLE, "northwind").map((person) => person.id)).toEqual(["u1", "u3"]);
    expect(filterPeople(PEOPLE, "other.dev").map((person) => person.id)).toEqual(["u2"]);
    expect(filterPeople(PEOPLE, "lovelace").map((person) => person.id)).toEqual(["u3"]);
  });

  it("returns everyone for an empty query", () => {
    expect(filterPeople(PEOPLE, "")).toHaveLength(3);
  });

  it("returns nobody rather than everybody when nothing matches", () => {
    expect(filterPeople(PEOPLE, "zzz")).toEqual([]);
  });
});

describe("filterByQuery", () => {
  it("narrows any list by the fields the caller nominates", () => {
    const sessions = [
      { id: "s1", title: "Evals that survive", speakers: ["Priya Raman"] },
      { id: "s2", title: "Tool schemas", speakers: ["Ada Lovelace"] },
    ];
    const found = filterByQuery(sessions, "ada", (session) => [
      session.title,
      session.speakers.join(" "),
    ]);
    expect(found.map((session) => session.id)).toEqual(["s2"]);
  });
});

describe("buildGroups", () => {
  const groups = buildGroups(PEOPLE, [
    { id: "all", label: "All speakers", matches: () => true },
    { id: "unconfirmed", label: "Not confirmed", matches: (p) => !p.confirmed, tone: "warning" },
    { id: "behind", label: "Behind on tasks", matches: (p) => p.pendingTasks > 0 },
    { id: "nobody", label: "Declined", matches: () => false },
  ]);

  it("resolves each group to exactly the ids it selects", () => {
    expect(groups.map((group) => [group.id, group.ids])).toEqual([
      ["all", ["u1", "u2", "u3"]],
      ["unconfirmed", ["u2", "u3"]],
      ["behind", ["u2", "u3"]],
    ]);
  });

  it("drops groups nobody is in", () => {
    expect(groups.some((group) => group.id === "nobody")).toBe(false);
  });

  it("keeps the caller's tone, defaulting to neutral", () => {
    expect(groups.find((group) => group.id === "unconfirmed")?.tone).toBe("warning");
    expect(groups.find((group) => group.id === "all")?.tone).toBe("default");
  });
});

describe("sameSelection", () => {
  it("ignores order and duplicates", () => {
    expect(sameSelection(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSelection(["a", "a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false when the members differ", () => {
    expect(sameSelection(["a"], ["a", "b"])).toBe(false);
    expect(sameSelection(["a"], ["b"])).toBe(false);
  });
});

describe("activeGroupId", () => {
  const groups = buildGroups(PEOPLE, [
    { id: "all", label: "All", matches: () => true },
    { id: "unconfirmed", label: "Not confirmed", matches: (p) => !p.confirmed },
  ]);

  it("names the group whose members are exactly the selection", () => {
    expect(activeGroupId(groups, ["u3", "u2"])).toBe("unconfirmed");
    expect(activeGroupId(groups, ["u1", "u2", "u3"])).toBe("all");
  });

  it("goes quiet once the selection is hand-edited", () => {
    expect(activeGroupId(groups, ["u2"])).toBeNull();
    expect(activeGroupId(groups, [])).toBeNull();
  });
});

describe("toggleSelection", () => {
  it("adds an unticked id and removes a ticked one", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("isLongList", () => {
  it("leaves a screenful of options alone and offers search above it", () => {
    expect(isLongList(LONG_LIST_THRESHOLD)).toBe(false);
    expect(isLongList(LONG_LIST_THRESHOLD + 1)).toBe(true);
    expect(isLongList(0)).toBe(false);
  });
});

describe("selectionSummary", () => {
  it("counts in the caller's nouns", () => {
    expect(selectionSummary(12)).toBe("Going to 12 people");
    expect(selectionSummary(1)).toBe("Going to 1 person");
    expect(
      selectionSummary(4, { lead: "Assigning", singular: "submission", plural: "submissions" }),
    ).toBe("Assigning 4 submissions");
  });

  it("says nothing is picked instead of counting zero", () => {
    expect(selectionSummary(0)).toBe("Nobody picked yet");
    expect(selectionSummary(0, { empty: "No submissions ticked" })).toBe("No submissions ticked");
  });
});
