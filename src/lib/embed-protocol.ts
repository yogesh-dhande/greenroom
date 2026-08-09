/**
 * The auto-resize handshake between a chrome-less `/embed/[eventSlug]/*` page
 * and whatever is hosting it in an `<iframe>` (spec.md "embeddable on an
 * external website"; decisions.md D-040). The embed page has no idea how
 * tall its host wants it, and the host has no idea how tall the embed's
 * content is — so the embed posts its height up via `window.postMessage`,
 * scoped with this message `type` so it's unambiguous next to whatever else
 * a host page's own scripts might be posting around.
 *
 * Shared by both ends so they can't drift apart: `EmbedAutoSize` (the client
 * component added to the embed layout, the emitter) and the generated script
 * served from `/embed.js` (the listener, built by interpolating this
 * constant into a plain-JS template — see src/app/embed.js/route.ts).
 */
export const EMBED_RESIZE_MESSAGE_TYPE = "greenroom:embed-resize";

export interface EmbedResizeMessage {
  type: typeof EMBED_RESIZE_MESSAGE_TYPE;
  height: number;
}
