import { describe, expect, it } from "vitest";
import { EMBED_RESIZE_MESSAGE_TYPE } from "@/lib/embed-protocol";
import { GET } from "./route";

/**
 * The one-line JS embed (decisions.md D-040's headline mechanism). No
 * datastore involved — this route just serves a fixed script — so the whole
 * thing is testable by fetching it and inspecting the text, unlike the
 * feed.json/feed.ics routes which need repos (covered instead via
 * src/domain/program.test.ts's pure serialization functions).
 */
describe("GET /embed.js", () => {
  it("serves JavaScript with a cache header, no auth or datastore involved", async () => {
    const response = await GET();

    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toMatch(/max-age=\d+/);
  });

  it("finds its own <script> tag by data-event/data-view, falling back off document.currentScript", async () => {
    const script = await (await GET()).text();

    expect(script).toContain("document.currentScript");
    expect(script).toContain('getAttribute("data-event")');
    expect(script).toContain('getAttribute("data-view")');
  });

  it("injects an iframe pointing at /embed/<event>/<view>, resolved from the script's own origin", async () => {
    const script = await (await GET()).text();

    expect(script).toContain('document.createElement("iframe")');
    expect(script).toContain('"/embed/" + encodeURIComponent(eventSlug)');
    expect(script).toContain("new URL(script.src, window.location.href)");
    expect(script).toContain("insertBefore(iframe, script.nextSibling)");
  });

  it("listens for the auto-resize handshake, scoped to its own injected iframe", async () => {
    const script = await (await GET()).text();

    expect(script).toContain(`var RESIZE_TYPE = ${JSON.stringify(EMBED_RESIZE_MESSAGE_TYPE)};`);
    expect(script).toContain('addEventListener("message"');
    // Scoped by both origin and by which iframe posted it, so two embeds on
    // one host page can't apply each other's height.
    expect(script).toContain("event.origin !== origin");
    expect(script).toContain("event.source !== iframe.contentWindow");
    expect(script).toContain("data.type !== RESIZE_TYPE");
    expect(script).toContain('iframe.style.height = data.height + "px"');
  });

  it("is valid enough JavaScript to at least parse (new Function, no execution)", async () => {
    const script = await (await GET()).text();
    expect(() => new Function(script)).not.toThrow();
  });
});
