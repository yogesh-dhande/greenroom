import { EMBED_RESIZE_MESSAGE_TYPE } from "@/lib/embed-protocol";

/**
 * The one-line JS embed (decisions.md D-040's headline option — the format
 * Sessionboard's own customers actually paste, per their help center's
 * "Embed Styled HTML — one line of JavaScript"). Usage:
 *
 *   <script src="https://<host>/embed.js"
 *           data-path="/embed/<slug>/schedule?widget=agenda" async></script>
 *
 * Served as a plain hand-written string — no bundler, no build step — kept
 * dependency-free on purpose since it runs on an arbitrary third-party page
 * we don't control. It:
 *
 *  1. Finds its own `<script>` tag (`document.currentScript`, with a
 *     `data-event` + `/embed.js` scan as a fallback for the rare browser/
 *     loader combination that leaves `currentScript` null).
 *  2. Reads a same-origin `/embed/` path (or the legacy `data-event` and
 *     `data-view` pair) and injects an `<iframe>` pointing at that page,
 *     right after the script tag.
 *  3. Listens for the auto-resize handshake (src/lib/embed-protocol.ts,
 *     emitted by `EmbedAutoSize` in the embed layout) and grows the iframe
 *     to fit — scoped to *this* injected iframe specifically via
 *     `event.source === iframe.contentWindow` (and an origin check), so two
 *     embeds dropped on the same host page can't apply each other's height.
 *
 * `origin` is read off the script's own `src` rather than hard-coded, so the
 * same script works unmodified from any deployment (preview, custom domain).
 *
 * Cached hard: the script's behavior only changes on a Greenroom deploy, and
 * every consumer is loading it fresh off our own host — an hour of browser
 * caching plus a day of shared-cache/stale-while-revalidate keeps it fast
 * without needing a cache-busting query string.
 */
const SCRIPT = `(function () {
  "use strict";
  var RESIZE_TYPE = ${JSON.stringify(EMBED_RESIZE_MESSAGE_TYPE)};
  var VALID_VIEWS = { schedule: true, speakers: true };

  var script = document.currentScript;
  if (!script) {
    var candidates = document.getElementsByTagName("script");
    for (var i = candidates.length - 1; i >= 0; i--) {
      var candidate = candidates[i];
      if ((candidate.getAttribute("data-path") || candidate.getAttribute("data-event")) && /\\/embed\\.js(\\?|$)/.test(candidate.src)) {
        script = candidate;
        break;
      }
    }
  }
  if (!script) return;

  var scriptUrl;
  try {
    scriptUrl = new URL(script.src, window.location.href);
  } catch (err) {
    return;
  }
  var origin = scriptUrl.origin;
  var configuredPath = script.getAttribute("data-path");
  var embedUrl;
  if (configuredPath) {
    try {
      var configuredUrl = new URL(configuredPath, origin);
      if (configuredUrl.origin !== origin || configuredUrl.pathname.indexOf("/embed/") !== 0) return;
      embedUrl = configuredUrl.href;
    } catch (err) {
      return;
    }
  } else {
    var eventSlug = script.getAttribute("data-event");
    var view = script.getAttribute("data-view") || "schedule";
    if (!eventSlug || !VALID_VIEWS[view]) return;
    embedUrl = origin + "/embed/" + encodeURIComponent(eventSlug) + "/" + view;
  }

  var iframe = document.createElement("iframe");
  iframe.src = embedUrl;
  iframe.title = "Event program";
  iframe.loading = "lazy";
  iframe.setAttribute("scrolling", "no");
  iframe.style.width = "100%";
  iframe.style.border = "0";
  iframe.style.minHeight = "480px";

  if (script.parentNode) {
    script.parentNode.insertBefore(iframe, script.nextSibling);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    if (event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== RESIZE_TYPE) return;
    if (typeof data.height === "number" && data.height > 0) {
      iframe.style.height = data.height + "px";
    }
  });
})();
`;

export async function GET(): Promise<Response> {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
