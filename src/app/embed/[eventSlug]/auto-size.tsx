"use client";

import { useEffect } from "react";
import { EMBED_RESIZE_MESSAGE_TYPE, type EmbedResizeMessage } from "@/lib/embed-protocol";

/**
 * Reports this page's rendered height to whatever `<iframe>` is hosting it
 * (decisions.md D-040's auto-sizing one-line JS embed). Renders `null` — its
 * only job is the `postMessage` side effect. A no-op when the page isn't
 * actually framed (e.g. someone opens `/embed/<slug>/schedule` directly),
 * since `window.parent === window` in that case.
 *
 * Posts on mount, on every size change (`ResizeObserver` on the root
 * element, which fires for content changes — search/filter, image loads —
 * not just window resizes), and on `window`'s `resize` event for host pages
 * that themselves resize the iframe's container. Targets `"*"` because the
 * embed has no way to know the host's origin in advance; the listener on the
 * other end (src/app/embed.js/route.ts) is what scopes trust, by checking
 * `event.source` against the specific iframe it created.
 */
export function EmbedAutoSize() {
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;

    const postHeight = () => {
      const height = document.documentElement.scrollHeight;
      const message: EmbedResizeMessage = { type: EMBED_RESIZE_MESSAGE_TYPE, height };
      window.parent.postMessage(message, "*");
    };

    postHeight();
    window.addEventListener("load", postHeight);
    window.addEventListener("resize", postHeight);

    const observer = new ResizeObserver(postHeight);
    observer.observe(document.documentElement);

    return () => {
      window.removeEventListener("load", postHeight);
      window.removeEventListener("resize", postHeight);
      observer.disconnect();
    };
  }, []);

  return null;
}
