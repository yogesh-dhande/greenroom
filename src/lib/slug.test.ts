import { describe, expect, it } from "vitest";
import { isReservedEventSlug, RESERVED_EVENT_SLUGS, SLUG_PATTERN, slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates free text", () => {
    expect(slugify("AI Engineer Summit 2026")).toBe("ai-engineer-summit-2026");
  });

  it("strips accents", () => {
    expect(slugify("Café Zürich Räume")).toBe("cafe-zurich-raume");
  });

  it("collapses runs of symbols into one hyphen", () => {
    expect(slugify("Dev // Ops & You!")).toBe("dev-ops-you");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  --Hello World--  ")).toBe("hello-world");
  });

  it("returns an empty string when nothing survives", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("always produces output matching SLUG_PATTERN (or empty)", () => {
    for (const input of ["Track: AI & ML", "éé", "a", "A B C", "9 to 5"]) {
      const slug = slugify(input);
      if (slug !== "") expect(slug).toMatch(SLUG_PATTERN);
    }
  });
});

describe("reserved event slugs", () => {
  it("reserves the /admin/new route segment", () => {
    expect(RESERVED_EVENT_SLUGS).toContain("new");
    expect(isReservedEventSlug("new")).toBe(true);
  });

  it("reserves the org-level CRM segments (decisions.md D-077)", () => {
    for (const slug of ["directory", "pipeline", "crm"]) {
      expect(RESERVED_EVENT_SLUGS).toContain(slug);
      expect(isReservedEventSlug(slug)).toBe(true);
    }
  });

  it("reserves them case-insensitively and ignores stray whitespace", () => {
    expect(isReservedEventSlug("Directory")).toBe(true);
    expect(isReservedEventSlug("CRM")).toBe(true);
    expect(isReservedEventSlug("  Pipeline  ")).toBe(true);
  });

  it("leaves ordinary event slugs alone, including ones that merely contain a reserved word", () => {
    for (const slug of ["ai-summit-2026", "crm-summit", "directory-services", "newsroom"]) {
      expect(isReservedEventSlug(slug)).toBe(false);
    }
  });
});
