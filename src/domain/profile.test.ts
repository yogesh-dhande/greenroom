import { describe, expect, it } from "vitest";
import {
  nextHeadshotUrl,
  parseProfileInput,
  profileFormValues,
  profileLinks,
  PROFILE_LIMITS,
} from "./profile";

const BLANK = {
  name: null,
  title: null,
  company: null,
  bio: null,
  headshotUrl: null,
  websiteUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
};

/** Everything a valid save sends, so each test can vary one thing. */
function submitted(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Priya Raman",
    title: "Staff Engineer",
    company: "Northwind",
    bio: "Builds retrieval systems.",
    headshot: "",
    website_url: "",
    linkedin_url: "",
    twitter_url: "",
    ...overrides,
  };
}

function patchOf(values: Record<string, unknown>, currentHeadshotUrl: string | null = null) {
  const result = parseProfileInput(values, { headshotUrl: currentHeadshotUrl });
  if (!result.ok) throw new Error(`expected a valid profile, got ${JSON.stringify(result.errors)}`);
  return result.patch;
}

function errorsOf(values: Record<string, unknown>) {
  const result = parseProfileInput(values, { headshotUrl: null });
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

describe("parseProfileInput", () => {
  it("trims text and turns empty boxes into null", () => {
    const patch = patchOf(
      submitted({ name: "  Priya Raman  ", title: "   ", company: "", bio: "  Hi.  " }),
    );
    expect(patch).toMatchObject({
      name: "Priya Raman",
      title: null,
      company: null,
      bio: "Hi.",
      websiteUrl: null,
      linkedinUrl: null,
      twitterUrl: null,
    });
  });

  it("requires a name", () => {
    expect(errorsOf(submitted({ name: "   " })).name).toBe("Your name is required");
    // A missing key is as blank as an empty string.
    expect(errorsOf(submitted({ name: undefined })).name).toBeTruthy();
  });

  it("rejects non-string values the same way as empty ones", () => {
    expect(errorsOf(submitted({ name: 42 })).name).toBeTruthy();
    expect(patchOf(submitted({ title: { evil: true } })).title).toBeNull();
  });

  it("keeps http(s) links and rejects anything else", () => {
    const patch = patchOf(
      submitted({
        website_url: "  https://priya.dev  ",
        linkedin_url: "http://linkedin.com/in/priya",
        twitter_url: "https://x.com/priya",
      }),
    );
    expect(patch.websiteUrl).toBe("https://priya.dev");
    expect(patch.linkedinUrl).toBe("http://linkedin.com/in/priya");
    expect(patch.twitterUrl).toBe("https://x.com/priya");

    expect(errorsOf(submitted({ website_url: "priya.dev" })).website_url).toBe(
      "Enter a full link, starting with https://",
    );
    expect(errorsOf(submitted({ linkedin_url: "@priya" })).linkedin_url).toBeTruthy();
    // Never let a public-page href become script or inline content.
    expect(errorsOf(submitted({ twitter_url: "javascript:alert(1)" })).twitter_url).toBeTruthy();
    expect(errorsOf(submitted({ website_url: "data:text/html,<b>x" })).website_url).toBeTruthy();
    expect(errorsOf(submitted({ website_url: "ftp://files.example.com" })).website_url).toBeTruthy();
  });

  it("caps each field's length", () => {
    expect(errorsOf(submitted({ name: "a".repeat(PROFILE_LIMITS.name + 1) })).name).toBeTruthy();
    expect(errorsOf(submitted({ title: "a".repeat(PROFILE_LIMITS.title + 1) })).title).toBeTruthy();
    expect(
      errorsOf(submitted({ company: "a".repeat(PROFILE_LIMITS.company + 1) })).company,
    ).toBeTruthy();
    expect(errorsOf(submitted({ bio: "a".repeat(PROFILE_LIMITS.bio + 1) })).bio).toBeTruthy();
    expect(
      errorsOf(submitted({ website_url: `https://e.dev/${"a".repeat(PROFILE_LIMITS.url)}` }))
        .website_url,
    ).toBeTruthy();

    // Exactly at the limit is fine.
    expect(patchOf(submitted({ bio: "a".repeat(PROFILE_LIMITS.bio) })).bio).toHaveLength(
      PROFILE_LIMITS.bio,
    );
  });

  it("reports every bad field at once, keyed by form field id", () => {
    const errors = errorsOf(submitted({ name: "", website_url: "nope", twitter_url: "also-nope" }));
    expect(Object.keys(errors).sort()).toEqual(["name", "twitter_url", "website_url"]);
  });

  it("stores a picked headshot as the URL that serves it back", () => {
    const patch = patchOf(submitted({ headshot: "uploads/profile/abc12345-headshot.png" }));
    expect(patch.headshotUrl).toBe("/files/uploads/profile/abc12345-headshot.png");
  });
});

describe("nextHeadshotUrl", () => {
  it("clears an uploaded headshot when the box is emptied", () => {
    expect(nextHeadshotUrl("", "/files/uploads/profile/abc12345-old.png")).toBeNull();
  });

  it("replaces an uploaded headshot with the newly picked one", () => {
    expect(nextHeadshotUrl("uploads/profile/ff001122-new.png", "/files/uploads/profile/old.png"))
      .toBe("/files/uploads/profile/ff001122-new.png");
  });

  it("leaves an externally hosted headshot alone when the box is empty", () => {
    // Seed/demo data stores absolute URLs, which the file control can't
    // represent — an empty box there means "nothing picked", not "remove".
    expect(nextHeadshotUrl("", "https://files.greenroom.dev/demo/priya.jpg")).toBe(
      "https://files.greenroom.dev/demo/priya.jpg",
    );
  });

  it("is null when there was nothing and nothing was picked", () => {
    expect(nextHeadshotUrl("", null)).toBeNull();
  });
});

describe("profileFormValues", () => {
  it("renders nulls as empty strings so every input is controlled", () => {
    expect(profileFormValues(BLANK)).toEqual({
      name: "",
      title: "",
      company: "",
      bio: "",
      headshot: "",
      website_url: "",
      linkedin_url: "",
      twitter_url: "",
    });
  });

  it("round-trips a stored headshot URL back into its upload key", () => {
    const values = profileFormValues({
      ...BLANK,
      headshotUrl: "/files/uploads/profile/abc12345-headshot.png",
    });
    expect(values.headshot).toBe("uploads/profile/abc12345-headshot.png");
    expect(patchOf(submitted({ headshot: values.headshot })).headshotUrl).toBe(
      "/files/uploads/profile/abc12345-headshot.png",
    );
  });

  it("leaves the file control empty for an externally hosted headshot", () => {
    const values = profileFormValues({ ...BLANK, headshotUrl: "https://cdn.example.com/p.jpg" });
    expect(values.headshot).toBe("");
  });
});

describe("profileLinks", () => {
  it("returns only the links that are set, in display order", () => {
    expect(
      profileLinks({
        websiteUrl: "https://priya.dev",
        linkedinUrl: null,
        twitterUrl: "https://x.com/priya",
      }).map((link) => link.kind),
    ).toEqual(["website", "twitter"]);
  });

  it("drops anything that isn't a followable http(s) link", () => {
    expect(
      profileLinks({
        websiteUrl: "javascript:alert(1)",
        linkedinUrl: "   ",
        twitterUrl: "priya.dev",
      }),
    ).toEqual([]);
  });
});
