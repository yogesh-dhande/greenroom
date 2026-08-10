import { describe, expect, it } from "vitest";
import { describeDirectoryFilter } from "./filter-summary";

describe("describeDirectoryFilter", () => {
  it("names the whole directory when nothing narrows", () => {
    expect(describeDirectoryFilter(undefined)).toBe("Everyone in the directory");
    expect(describeDirectoryFilter({})).toBe("Everyone in the directory");
    expect(describeDirectoryFilter({ q: "   ", company: "", tag: "" })).toBe(
      "Everyone in the directory",
    );
  });

  it("describes one criterion at a time", () => {
    expect(describeDirectoryFilter({ q: "ada" })).toBe('search "ada"');
    expect(describeDirectoryFilter({ company: "Northwind" })).toBe(
      'company contains "Northwind"',
    );
    expect(describeDirectoryFilter({ tag: "ai" })).toBe('tagged "ai"');
  });

  it("joins criteria in a fixed order, so a segment reads the same everywhere", () => {
    expect(describeDirectoryFilter({ tag: "ai", company: "Northwind", q: "ada" })).toBe(
      'search "ada" · company contains "Northwind" · tagged "ai"',
    );
  });

  it("describes the normalized filter, not the raw input", () => {
    // Same normalization the query runs, so the words on screen and the rows
    // in the table can't disagree about what was asked for.
    expect(describeDirectoryFilter({ q: "  ada  ", tag: "  AI " })).toBe(
      'search "ada" · tagged "ai"',
    );
  });
});
