import { describe, expect, it } from "vitest";
import type { Deliverable } from "@/domain/files";
import {
  assignSpeakerFolders,
  buildZipEntries,
  claimFilename,
  MAX_SEGMENT_LENGTH,
  numberedFilename,
  parseZipGrouping,
  sanitizeFilename,
  sanitizeSegment,
  storeWithoutCompression,
  UNKNOWN_SPEAKER_FOLDER,
  zipArchiveFilename,
} from "@/domain/file-export";

function deliverable(
  speakerId: string,
  filename: string,
  key: string | null = `uploads/task-1/abcd1234-${filename}`,
): Pick<Deliverable, "speakerId" | "current"> {
  return {
    speakerId,
    current: {
      key,
      url: key ? `/files/${key}` : "https://example.com/legacy.pdf",
      filename,
      uploadedAt: new Date("2026-05-01T10:00:00Z"),
      uploadedBy: speakerId,
    },
  };
}

describe("sanitizeSegment", () => {
  it("keeps an ordinary name readable", () => {
    expect(sanitizeSegment("Ada Lovelace", "x")).toBe("Ada Lovelace");
  });

  it("replaces path separators so a name cannot invent a folder", () => {
    expect(sanitizeSegment("a/b", "x")).toBe("a-b");
    expect(sanitizeSegment("a\\b", "x")).toBe("a-b");
    expect(sanitizeSegment("../../etc/passwd", "x")).toBe("-..-etc-passwd");
  });

  it("strips control characters", () => {
    expect(sanitizeSegment("de\u0000c\u001bk\u007f", "x")).toBe("deck");
    expect(sanitizeSegment("line\nbreak", "x")).toBe("linebreak");
  });

  it("replaces the characters Windows reserves", () => {
    expect(sanitizeSegment('a:b*c?d"e<f>g|h', "x")).toBe("a-b-c-d-e-f-g-h");
  });

  it("trims leading and trailing dots and spaces", () => {
    expect(sanitizeSegment("  .hidden.  ", "x")).toBe("hidden");
  });

  it("falls back when nothing usable survives", () => {
    expect(sanitizeSegment("", "fallback")).toBe("fallback");
    expect(sanitizeSegment("...", "fallback")).toBe("fallback");
    expect(sanitizeSegment("\u0001\u0002", "fallback")).toBe("fallback");
    expect(sanitizeSegment("..", "fallback")).toBe("fallback");
  });

  it("caps the length and never leaves a trailing dot behind", () => {
    const long = `${"a".repeat(MAX_SEGMENT_LENGTH - 1)}.tail`;
    const result = sanitizeSegment(long, "x");
    expect(result.length).toBeLessThanOrEqual(MAX_SEGMENT_LENGTH);
    expect(result.endsWith(".")).toBe(false);
  });

  it("leaves an accented name intact, in one composed form", () => {
    // "Bjorn" with an o-umlaut, given decomposed (o + combining diaeresis)
    // the way a Mac-typed name arrives; it must come back composed, so the
    // same person never gets two folders.
    expect(sanitizeSegment("Bjo\u0308rn", "x")).toBe("Bj\u00f6rn");
    expect(sanitizeSegment("Bj\u00f6rn", "x")).toBe("Bj\u00f6rn");
  });
});

describe("sanitizeFilename", () => {
  it("passes an ordinary filename through", () => {
    expect(sanitizeFilename("keynote deck.pdf")).toBe("keynote deck.pdf");
  });

  it("names an unusable filename rather than dropping the file", () => {
    expect(sanitizeFilename("///")).toBe("---");
    expect(sanitizeFilename("")).toBe("file");
  });

  it("keeps the extension when it has to truncate", () => {
    const result = sanitizeFilename(`${"deck".repeat(40)}.pdf`);
    expect(result.length).toBeLessThanOrEqual(MAX_SEGMENT_LENGTH);
    expect(result.endsWith(".pdf")).toBe(true);
  });

  it("treats a dotfile as a stem, not as an extension", () => {
    expect(sanitizeFilename(".gitignore")).toBe("gitignore");
  });
});

describe("numberedFilename", () => {
  it("puts the counter before the extension", () => {
    expect(numberedFilename("deck.pdf", 2)).toBe("deck-2.pdf");
    expect(numberedFilename("my.slides.pptx", 3)).toBe("my.slides-3.pptx");
  });

  it("appends to a name with no extension", () => {
    expect(numberedFilename("notes", 2)).toBe("notes-2");
  });
});

describe("claimFilename", () => {
  it("leaves the first claim alone and suffixes the rest", () => {
    const taken = new Set<string>();
    expect(claimFilename(taken, "deck.pdf")).toBe("deck.pdf");
    expect(claimFilename(taken, "deck.pdf")).toBe("deck-2.pdf");
    expect(claimFilename(taken, "deck.pdf")).toBe("deck-3.pdf");
  });

  it("does not hand out a name an earlier suffix already took", () => {
    const taken = new Set<string>();
    expect(claimFilename(taken, "deck-2.pdf")).toBe("deck-2.pdf");
    expect(claimFilename(taken, "deck.pdf")).toBe("deck.pdf");
    expect(claimFilename(taken, "deck.pdf")).toBe("deck-3.pdf");
  });

  it("collides case-insensitively, the way an extractor will", () => {
    const taken = new Set<string>();
    expect(claimFilename(taken, "Deck.pdf")).toBe("Deck.pdf");
    expect(claimFilename(taken, "deck.pdf")).toBe("deck-2.pdf");
  });
});

describe("assignSpeakerFolders", () => {
  it("uses the speaker's name", () => {
    const folders = assignSpeakerFolders([{ id: "u1", label: "Ada Lovelace" }]);
    expect(folders.get("u1")).toBe("Ada Lovelace");
  });

  it("suffixes every speaker sharing a name, not just the later one", () => {
    const folders = assignSpeakerFolders([
      { id: "u1", label: "John Smith" },
      { id: "u2", label: "John Smith" },
    ]);
    expect(folders.get("u1")).toBe("John Smith u1");
    expect(folders.get("u2")).toBe("John Smith u2");
  });

  it("treats a name that differs only in case as the same name", () => {
    const folders = assignSpeakerFolders([
      { id: "u1", label: "john smith" },
      { id: "u2", label: "John Smith" },
    ]);
    expect(folders.get("u1")).toBe("john smith u1");
    expect(folders.get("u2")).toBe("John Smith u2");
  });

  it("does not treat one speaker listed twice as a collision", () => {
    const folders = assignSpeakerFolders([
      { id: "u1", label: "Ada Lovelace" },
      { id: "u1", label: "Ada Lovelace" },
    ]);
    expect(folders.get("u1")).toBe("Ada Lovelace");
  });

  it("names an unresolvable speaker rather than skipping their files", () => {
    const folders = assignSpeakerFolders([{ id: "u9", label: "" }]);
    expect(folders.get("u9")).toBe(UNKNOWN_SPEAKER_FOLDER);
  });

  it("sanitizes the folder before comparing it", () => {
    const folders = assignSpeakerFolders([{ id: "u1", label: "Team/Ops" }]);
    expect(folders.get("u1")).toBe("Team-Ops");
  });
});

describe("buildZipEntries", () => {
  const labels = new Map([
    ["u1", "Ada Lovelace"],
    ["u2", "Grace Hopper"],
  ]);

  it("folders each file under its speaker", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "deck.pdf"), deliverable("u2", "headshot.jpg")],
      speakerLabelById: labels,
    });
    expect(entries.map((entry) => entry.path)).toEqual([
      "Ada Lovelace/deck.pdf",
      "Grace Hopper/headshot.jpg",
    ]);
  });

  it("carries the R2 key through untouched", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "deck.pdf", "uploads/task-1/abcd1234-deck.pdf")],
      speakerLabelById: labels,
    });
    expect(entries[0].key).toBe("uploads/task-1/abcd1234-deck.pdf");
  });

  it("suffixes duplicate filenames inside one folder only", () => {
    const entries = buildZipEntries({
      deliverables: [
        deliverable("u1", "deck.pdf", "uploads/a/1111aaaa-deck.pdf"),
        deliverable("u1", "deck.pdf", "uploads/b/2222bbbb-deck.pdf"),
        deliverable("u2", "deck.pdf", "uploads/c/3333cccc-deck.pdf"),
      ],
      speakerLabelById: labels,
    });
    expect(entries.map((entry) => entry.path)).toEqual([
      "Ada Lovelace/deck.pdf",
      "Ada Lovelace/deck-2.pdf",
      "Grace Hopper/deck.pdf",
    ]);
  });

  it("drops a row whose current file is not a stored object", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "legacy.pdf", null), deliverable("u1", "deck.pdf")],
      speakerLabelById: labels,
    });
    expect(entries.map((entry) => entry.path)).toEqual(["Ada Lovelace/deck.pdf"]);
  });

  it("returns nothing when there is nothing stored to archive", () => {
    expect(
      buildZipEntries({
        deliverables: [deliverable("u1", "legacy.pdf", null)],
        speakerLabelById: labels,
      }),
    ).toEqual([]);
  });

  it("files an unknown speaker's upload rather than losing it", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("ghost", "deck.pdf")],
      speakerLabelById: labels,
    });
    expect(entries.map((entry) => entry.path)).toEqual([`${UNKNOWN_SPEAKER_FOLDER}/deck.pdf`]);
  });

  it("keeps two same-named speakers' files apart", () => {
    const entries = buildZipEntries({
      deliverables: [
        deliverable("u1", "deck.pdf", "uploads/a/1111aaaa-deck.pdf"),
        deliverable("u2", "deck.pdf", "uploads/b/2222bbbb-deck.pdf"),
      ],
      speakerLabelById: new Map([
        ["u1", "John Smith"],
        ["u2", "John Smith"],
      ]),
    });
    expect(entries.map((entry) => entry.path)).toEqual([
      "John Smith u1/deck.pdf",
      "John Smith u2/deck.pdf",
    ]);
  });

  it("never emits a path with more than one separator", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "reports/q3/deck.pdf")],
      speakerLabelById: new Map([["u1", "Ops/Team"]]),
    });
    expect(entries[0].path.split("/")).toHaveLength(2);
  });

  it("groups selected files by each session their speaker belongs to", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "deck.pdf")],
      speakerLabelById: labels,
      groupBy: "session",
      sessionTitlesBySpeaker: new Map([["u1", ["Opening / Keynote", "Deep dive"]]]),
    });
    expect(entries.map((entry) => entry.path)).toEqual([
      "Opening - Keynote/deck.pdf",
      "Deep dive/deck.pdf",
    ]);
  });

  it("uses a no-session folder when session grouping has no match", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "deck.pdf")],
      speakerLabelById: labels,
      groupBy: "session",
      sessionTitlesBySpeaker: new Map(),
    });
    expect(entries[0].path).toBe("No session/deck.pdf");
  });

  it("can export a flat archive while still resolving collisions", () => {
    const entries = buildZipEntries({
      deliverables: [deliverable("u1", "deck.pdf"), deliverable("u2", "deck.pdf")],
      speakerLabelById: labels,
      groupBy: "flat",
    });
    expect(entries.map((entry) => entry.path)).toEqual(["deck.pdf", "deck-2.pdf"]);
  });
});

describe("parseZipGrouping", () => {
  it("accepts supported groupings and defaults unknown input to speaker", () => {
    expect(parseZipGrouping("session")).toBe("session");
    expect(parseZipGrouping("flat")).toBe("flat");
    expect(parseZipGrouping("anything-else")).toBe("speaker");
    expect(parseZipGrouping(null)).toBe("speaker");
  });
});

describe("storeWithoutCompression", () => {
  it("stores bytes that are already compressed", () => {
    expect(storeWithoutCompression("Ada Lovelace/headshot.JPG")).toBe(true);
    expect(storeWithoutCompression("Ada Lovelace/deck.pdf")).toBe(true);
    expect(storeWithoutCompression("Ada Lovelace/deck.pptx")).toBe(true);
  });

  it("deflates everything else", () => {
    expect(storeWithoutCompression("Ada Lovelace/notes.txt")).toBe(false);
    expect(storeWithoutCompression("Ada Lovelace/notes")).toBe(false);
  });
});

describe("zipArchiveFilename", () => {
  it("names the archive after the event", () => {
    expect(zipArchiveFilename("ai-engineer-2026")).toBe("ai-engineer-2026-files.zip");
  });
});
