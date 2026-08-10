import { describe, expect, it } from "vitest";
import {
  normalizeSegmentName,
  parseSegmentQuery,
  SEGMENT_QUERY_KEYS,
  segmentFilterOrEmpty,
  serializeSegmentQuery,
} from "@/domain/segments";

describe("serializeSegmentQuery", () => {
  it("stores only the fields that narrow something", () => {
    expect(serializeSegmentQuery({ q: "priya", company: "", tag: "  " })).toBe('{"q":"priya"}');
    expect(serializeSegmentQuery({})).toBe("{}");
    expect(serializeSegmentQuery(undefined)).toBe("{}");
  });

  it("normalizes before storing, so equivalent filters serialize identically", () => {
    expect(serializeSegmentQuery({ q: "  Priya  ", tag: " AI " })).toBe(
      serializeSegmentQuery({ q: "Priya", tag: "ai" }),
    );
  });

  it("writes keys in a fixed order regardless of how the object was built", () => {
    expect(serializeSegmentQuery({ tag: "ai", company: "Northwind", q: "priya" })).toBe(
      serializeSegmentQuery({ q: "priya", company: "Northwind", tag: "ai" }),
    );
    expect(serializeSegmentQuery({ tag: "ai", q: "priya" })).toBe('{"q":"priya","tag":"ai"}');
  });
});

describe("parseSegmentQuery", () => {
  it("round-trips every filter field", () => {
    const filter = { q: "priya", company: "Northwind", tag: "ai" };
    const result = parseSegmentQuery(serializeSegmentQuery(filter));
    expect(result).toEqual({ ok: true, filter });
  });

  it("reads an empty saved view as an unnarrowed directory", () => {
    expect(parseSegmentQuery("{}")).toEqual({ ok: true, filter: {} });
  });

  it("normalizes on the way out too", () => {
    const result = parseSegmentQuery('{"q":"  priya ","tag":" AI "}');
    expect(result).toEqual({ ok: true, filter: { q: "priya", tag: "ai" } });
  });

  it("rejects malformed JSON", () => {
    const result = parseSegmentQuery("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid JSON/);
  });

  it("rejects a payload that is not a filter object", () => {
    for (const raw of ["[]", '"q=priya"', "null", "42"]) {
      expect(parseSegmentQuery(raw).ok).toBe(false);
    }
  });

  it("rejects unknown keys instead of silently widening the segment", () => {
    const result = parseSegmentQuery('{"q":"priya","status":"confirmed","stage":"contacted"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Saved filter uses unknown fields: stage, status.");
  });

  it("names a single unknown key in the singular", () => {
    const result = parseSegmentQuery('{"eventId":"e1"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Saved filter uses unknown field: eventId.");
  });

  it("rejects a known key holding something other than text", () => {
    const result = parseSegmentQuery('{"q":["priya"]}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/"q" is not text/);
  });

  it("treats an explicit null as an absent field rather than an error", () => {
    expect(parseSegmentQuery('{"q":"priya","company":null}')).toEqual({
      ok: true,
      filter: { q: "priya" },
    });
  });

  it("covers exactly the documented key set", () => {
    expect([...SEGMENT_QUERY_KEYS].sort()).toEqual(["company", "q", "tag"]);
    for (const key of SEGMENT_QUERY_KEYS) {
      expect(parseSegmentQuery(JSON.stringify({ [key]: "value" })).ok).toBe(true);
    }
  });
});

describe("segmentFilterOrEmpty", () => {
  it("returns the filter when the query is readable", () => {
    expect(segmentFilterOrEmpty('{"tag":"ai"}')).toEqual({ tag: "ai" });
  });

  it("degrades an unreadable query to an unnarrowed filter rather than throwing", () => {
    expect(segmentFilterOrEmpty("{oops")).toEqual({});
    expect(segmentFilterOrEmpty('{"unknown":"x"}')).toEqual({});
  });
});

describe("normalizeSegmentName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeSegmentName("  AI   speakers ")).toBe("AI speakers");
  });

  it("returns null when the organizer typed nothing usable", () => {
    expect(normalizeSegmentName("   ")).toBeNull();
    expect(normalizeSegmentName(null)).toBeNull();
    expect(normalizeSegmentName(undefined)).toBeNull();
  });

  it("keeps the organizer's capitalization", () => {
    expect(normalizeSegmentName("Returning Keynotes")).toBe("Returning Keynotes");
  });
});
