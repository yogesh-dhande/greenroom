import { describe, expect, it } from "vitest";
import type { SessionContentStatus } from "@/db/entities";
import {
  ANY_CONTENT_STATUS,
  CONTENT_STATUS_LABEL,
  SESSION_CONTENT_STATUSES,
  canRestoreAbstract,
  filterByContentStatus,
  matchesContentStatus,
  normalizeAbstract,
  planAbstractRestore,
  planAbstractRevision,
  revisionPreview,
} from "@/domain/session-content";

function row(id: string, contentStatus: SessionContentStatus) {
  return { id, contentStatus };
}

describe("content status vocabulary (decisions.md D-072)", () => {
  it("lists the three editorial states in review order", () => {
    expect(SESSION_CONTENT_STATUSES).toEqual(["draft", "in_review", "approved"]);
  });

  it("labels every state", () => {
    for (const status of SESSION_CONTENT_STATUSES) {
      expect(CONTENT_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});

describe("matchesContentStatus / filterByContentStatus", () => {
  const sessions = [
    row("a", "draft"),
    row("b", "in_review"),
    row("c", "approved"),
    row("d", "approved"),
  ];

  it("the sentinel matches everything", () => {
    expect(filterByContentStatus(sessions, ANY_CONTENT_STATUS)).toEqual(sessions);
  });

  it("narrows to one status", () => {
    expect(filterByContentStatus(sessions, "approved").map((s) => s.id)).toEqual(["c", "d"]);
    expect(filterByContentStatus(sessions, "draft").map((s) => s.id)).toEqual(["a"]);
    expect(filterByContentStatus(sessions, "in_review").map((s) => s.id)).toEqual(["b"]);
  });

  it("an unrecognised value hides nothing", () => {
    // A hand-edited URL or a stale bookmark must not silently empty the board.
    expect(filterByContentStatus(sessions, "published")).toEqual(sessions);
    expect(matchesContentStatus(row("a", "draft"), "")).toBe(true);
  });

  it("does not confuse the scheduling 'draft' with the editorial one", () => {
    // Both enums have a "draft" member; the predicate only ever reads
    // contentStatus, so a confirmed-but-draft-content session is matched.
    const session = { ...row("a", "draft"), status: "confirmed" as const };
    expect(matchesContentStatus(session, "draft")).toBe(true);
    expect(matchesContentStatus(session, "approved")).toBe(false);
  });
});

describe("normalizeAbstract", () => {
  it("trims and treats blank as absent", () => {
    expect(normalizeAbstract("  hello  ")).toBe("hello");
    expect(normalizeAbstract("   ")).toBeNull();
    expect(normalizeAbstract("")).toBeNull();
    expect(normalizeAbstract(null)).toBeNull();
    expect(normalizeAbstract(undefined)).toBeNull();
  });
});

describe("planAbstractRevision (decisions.md D-071)", () => {
  it("records a real change", () => {
    expect(planAbstractRevision("Old text", "New text")).toEqual({
      priorValue: "Old text",
      newValue: "New text",
    });
  });

  it("records nothing when the abstract is unchanged", () => {
    expect(planAbstractRevision("Same text", "Same text")).toBeNull();
    expect(planAbstractRevision(null, null)).toBeNull();
    expect(planAbstractRevision(null, "")).toBeNull();
    expect(planAbstractRevision("", undefined)).toBeNull();
  });

  it("ignores whitespace-only differences", () => {
    // The save path trims before writing, so a stray newline never reaches
    // the database and must never grow a history row that says nothing.
    expect(planAbstractRevision("Same text", "  Same text\n")).toBeNull();
  });

  it("records a first set with a null prior value", () => {
    expect(planAbstractRevision(null, "The very first abstract")).toEqual({
      priorValue: null,
      newValue: "The very first abstract",
    });
    expect(planAbstractRevision("   ", "The very first abstract")).toEqual({
      priorValue: null,
      newValue: "The very first abstract",
    });
  });

  it("records a clearing with a null new value", () => {
    expect(planAbstractRevision("Something", "")).toEqual({
      priorValue: "Something",
      newValue: null,
    });
  });
});

describe("planAbstractRestore (decisions.md D-071)", () => {
  it("writes the earlier value back and records the restore as an edit", () => {
    // The rubric's shape: two edits, then restoring the first one. The value
    // being replaced becomes the new entry's prior value, so the history is
    // append-only and the restore is itself undoable.
    const first = "Version one.";
    const second = "Version one. Version two.";
    expect(planAbstractRestore(second, first)).toEqual({
      value: first,
      revision: { priorValue: second, newValue: first },
    });
  });

  it("is a no-op when that version is already the current abstract", () => {
    expect(planAbstractRestore("Same text", "Same text")).toBeNull();
    expect(planAbstractRestore("Same text", "  Same text\n")).toBeNull();
    expect(planAbstractRestore(null, null)).toBeNull();
    expect(planAbstractRestore("", null)).toBeNull();
  });

  it("restores an empty earlier abstract by clearing the current one", () => {
    expect(planAbstractRestore("Written later", null)).toEqual({
      value: null,
      revision: { priorValue: "Written later", newValue: null },
    });
  });

  it("canRestoreAbstract agrees with the planner", () => {
    expect(canRestoreAbstract("now", "before")).toBe(true);
    expect(canRestoreAbstract("now", "now")).toBe(false);
    expect(canRestoreAbstract(null, "before")).toBe(true);
  });

  it("survives a round trip: restore, then restore back", () => {
    const first = "Version one.";
    const second = "Version one. Version two.";
    const back = planAbstractRestore(second, first);
    expect(back?.value).toBe(first);
    // The entry the restore just wrote now offers the newer text again.
    const forward = planAbstractRestore(back?.value ?? null, back?.revision.priorValue ?? null);
    expect(forward?.value).toBe(second);
  });
});

describe("revisionPreview", () => {
  it("passes short values through untouched", () => {
    expect(revisionPreview("Short one")).toBe("Short one");
  });

  it("marks an empty prior value rather than rendering blank", () => {
    expect(revisionPreview(null)).toBe("(empty)");
  });

  it("truncates on a word boundary when there is one", () => {
    const preview = revisionPreview("alpha beta gamma delta", 12);
    expect(preview).toBe("alpha beta...");
  });

  it("falls back to a hard cut when no word boundary is close enough", () => {
    expect(revisionPreview("abcdefghijklmnopqrst", 10)).toBe("abcdefghij...");
  });
});
