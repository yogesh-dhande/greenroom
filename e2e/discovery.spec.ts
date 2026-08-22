import { expect, test } from "./fixtures";

/**
 * The discovery surface added after the 2026-08-18 evaluator run.
 *
 * That run spent its opening minutes collecting 404s: `/robots.txt`,
 * `/sitemap.xml`, `/llms.txt`, `/openapi.json`, `/docs`,
 * `/.well-known/mcp.json`, `/events/<slug>`, `/apply/<slug>`, and a dozen
 * unslugged public paths. Every one of those surfaces either existed one path
 * segment away or was resolvable from the URL. These tests hold the entry
 * points open — anonymously, because that is how an agent or crawler arrives.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";

test.describe("agent and crawler discovery", () => {
  test("robots.txt names the sitemap and keeps authenticated paths out", async ({ page }) => {
    const response = await page.goto("/robots.txt");
    expect(response?.status()).toBe(200);

    const body = await response!.text();
    expect(body).toContain("Sitemap:");
    expect(body).toContain("/sitemap.xml");
    for (const path of ["/admin", "/portal", "/api/", "/mcp"]) {
      expect(body).toContain(path);
    }
  });

  test("sitemap.xml lists the published program and no authenticated surface", async ({ page }) => {
    const response = await page.goto("/sitemap.xml");
    expect(response?.status()).toBe(200);
    expect(response!.headers()["content-type"]).toContain("xml");

    const body = await response!.text();
    // The seeded event has programPublished: true, so its program is listed.
    expect(body).toContain(`/p/${EVENT_SLUG}`);
    expect(body).toContain(`/p/${EVENT_SLUG}/schedule`);
    expect(body).toContain(`/p/${EVENT_SLUG}/speakers`);
    expect(body).not.toContain("/admin");
    expect(body).not.toContain("/portal");
  });

  test("llms.txt orients an agent to the REST and MCP surfaces", async ({ page }) => {
    const response = await page.goto("/llms.txt");
    expect(response?.status()).toBe(200);
    expect(response!.headers()["content-type"]).toContain("text/plain");

    const body = await response!.text();
    expect(body).toContain("/api/v1/openapi.json");
    expect(body).toContain("/api/docs");
    expect(body).toContain("/mcp");
    expect(body).toContain("greenroom:read");
  });

  test("/openapi.json reaches the real OpenAPI document", async ({ page }) => {
    const response = await page.goto("/openapi.json");
    expect(response?.status()).toBe(200);
    // Followed the redirect to the versioned path rather than serving a copy.
    expect(page.url()).toContain("/api/v1/openapi.json");

    const document = JSON.parse(await response!.text()) as { openapi: string };
    expect(document.openapi).toBe("3.1.0");
  });

  test("/docs reaches the API reference", async ({ page }) => {
    const response = await page.goto("/docs");
    expect(response?.status()).toBe(200);
    expect(page.url()).toContain("/api/docs");
  });

  test("/.well-known/mcp.json points at the real MCP endpoint", async ({ page }) => {
    const response = await page.goto("/.well-known/mcp.json");
    expect(response?.status()).toBe(200);

    const doc = JSON.parse(await response!.text()) as {
      endpoint: string;
      transport: { methods: string[] };
      authorization: { dynamicClientRegistration: boolean };
    };
    expect(doc.endpoint).toMatch(/\/mcp$/);
    expect(doc.transport.methods).toEqual(["POST"]);
    expect(doc.authorization.dynamicClientRegistration).toBe(true);
  });
});

test.describe("public URL aliases", () => {
  test("/events/<slug> redirects to the event's public program", async ({ page }) => {
    const response = await page.goto(`/events/${EVENT_SLUG}`);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/p/${EVENT_SLUG}`);
  });

  test("/events/<unknown-slug> is still an honest 404", async ({ page }) => {
    const response = await page.goto("/events/no-such-event-anywhere");
    expect(response?.status()).toBe(404);
  });

  test("/apply/<slug> lands on a call for speakers for that event", async ({ page }) => {
    const response = await page.goto(`/apply/${EVENT_SLUG}`);
    expect(response?.status()).toBe(200);

    // The seeded event runs more than one call at once, so the alias cannot
    // guess which was meant and sends the visitor to the landing page that
    // lists them. Either destination is correct; landing somewhere useful and
    // event-scoped is the contract.
    const path = new URL(page.url()).pathname;
    expect(path === `/p/${EVENT_SLUG}` || path.startsWith("/submit/")).toBe(true);
  });

  test("an unslugged public guess explains the URL shape instead of dead-ending", async ({
    page,
  }) => {
    // These are the exact paths the evaluator guessed. They cannot be resolved
    // — one deployment hosts many events and there is no event in the URL — so
    // the contract is that the 404 teaches the shape rather than saying nothing.
    for (const guess of ["/agenda", "/schedule", "/speakers", "/sessions", "/cfp"]) {
      const response = await page.goto(guess);
      expect(response?.status(), `${guess} should 404`).toBe(404);
      await expect(page.getByText("Looking for an event's program?")).toBeVisible();
      await expect(page.getByText("/p/<event>/schedule")).toBeVisible();
    }
  });
});
