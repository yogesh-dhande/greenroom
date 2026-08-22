import { beforeEach, describe, expect, it, vi } from "vitest";

const BASE = "https://greenroom.example";
vi.mock("@/lib/public-url", () => ({ publicBaseUrl: async () => BASE }));

const db = vi.hoisted(() => ({ listAll: vi.fn(), listPublishedByEvent: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getRepos: async () => ({
    events: { listAll: db.listAll },
    forms: { listPublishedByEvent: db.listPublishedByEvent },
  }),
}));

import sitemap from "./sitemap";
import robots from "./robots";

function event(slug: string, programPublished: boolean) {
  return { id: `id-${slug}`, slug, programPublished, updatedAt: new Date("2026-08-20T00:00:00Z") };
}

/** A published form whose window is open right now. */
function openForm() {
  return { isPublished: true, opensAt: new Date("2026-01-01T00:00:00Z"), closesAt: null };
}

beforeEach(() => {
  db.listAll.mockReset();
  db.listPublishedByEvent.mockReset();
  db.listPublishedByEvent.mockResolvedValue([]);
});

describe("sitemap", () => {
  it("never advertises an event its organizer has not announced", async () => {
    db.listAll.mockResolvedValue([event("live-conf", true), event("draft-conf", false)]);
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain(`${BASE}/p/live-conf`);
    // `/p/<slug>` stays reachable before publication — it renders a coming-soon
    // note — but the page still names the event, its dates, its location and
    // its description. Listing every slug would hand a crawler an enumerable
    // directory of events nobody has announced yet.
    expect(urls).not.toContain(`${BASE}/p/draft-conf`);
  });

  it("lists an unpublished event that has an open call for speakers", async () => {
    db.listAll.mockResolvedValue([event("cfp-conf", false)]);
    db.listPublishedByEvent.mockResolvedValue([openForm()]);
    const urls = (await sitemap()).map((entry) => entry.url);
    // An open CFP is the organizer announcing the event themselves: the
    // `/submit/<form>` link is public and lands people on this page.
    expect(urls).toContain(`${BASE}/p/cfp-conf`);
    // The program surfaces are still gated.
    expect(urls).not.toContain(`${BASE}/p/cfp-conf/schedule`);
  });

  it("does not list an unpublished event whose call for speakers has closed", async () => {
    db.listAll.mockResolvedValue([event("closed-conf", false)]);
    db.listPublishedByEvent.mockResolvedValue([
      { isPublished: true, opensAt: new Date("2026-01-01T00:00:00Z"), closesAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    expect((await sitemap()).map((entry) => entry.url)).not.toContain(`${BASE}/p/closed-conf`);
  });

  it("honours the D-056 publish gate for program surfaces", async () => {
    db.listAll.mockResolvedValue([event("live-conf", true), event("draft-conf", false)]);
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain(`${BASE}/p/live-conf/schedule`);
    expect(urls).toContain(`${BASE}/p/live-conf/speakers`);
    expect(urls).toContain(`${BASE}/p/live-conf/gallery`);

    // An unpublished program must not be advertised: those URLs render nothing
    // yet, and listing them announces the event before its organizer chose to.
    expect(urls).not.toContain(`${BASE}/p/draft-conf/schedule`);
    expect(urls).not.toContain(`${BASE}/p/draft-conf/speakers`);
    expect(urls).not.toContain(`${BASE}/p/draft-conf/gallery`);
  });

  it("never lists an authenticated surface", async () => {
    db.listAll.mockResolvedValue([event("live-conf", true)]);
    const urls = (await sitemap()).map((entry) => entry.url);
    for (const secret of ["/admin", "/portal", "/dashboard", "/api", "/mcp"]) {
      expect(urls.some((url) => url.includes(secret))).toBe(false);
    }
  });

  it("works with no events at all", async () => {
    db.listAll.mockResolvedValue([]);
    expect((await sitemap()).map((entry) => entry.url)).toEqual([`${BASE}/`]);
  });
});

describe("robots", () => {
  it("points crawlers at the sitemap on this deployment's origin", async () => {
    expect((await robots()).sitemap).toBe(`${BASE}/sitemap.xml`);
  });

  it("keeps authenticated and token-bearing paths out of the index", async () => {
    const rules = (await robots()).rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = rule.disallow;
    const list = Array.isArray(disallow) ? disallow : [disallow];

    for (const path of ["/admin", "/portal", "/dashboard", "/api/", "/mcp", "/oauth/"]) {
      expect(list).toContain(path);
    }
    // Draft-resume links carry a single-use token in the path.
    expect(list).toContain("/submit/*/resume/");
  });
});
