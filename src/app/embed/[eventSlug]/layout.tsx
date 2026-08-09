import { getPublicEvent } from "@/app/p/[eventSlug]/data";
import { EmbedAutoSize } from "./auto-size";

/**
 * Chrome-less layout for iframe embeds (spec.md "Important / strongly
 * desired": embeds suitable for iframing on a third-party site). No header,
 * nav, or footer — just the content, sized to fill whatever `<iframe>` a
 * host page provides. `getPublicEvent` 404s for an unknown slug, caught by
 * the sibling not-found.tsx; no auth here either (same public surface as
 * `/p/[eventSlug]`, just without the chrome).
 *
 * No X-Frame-Options / CSP frame-ancestors header is set anywhere in this
 * app (next.config.ts, custom-worker.ts, open-next.config.ts all checked),
 * so these routes are framable with zero extra configuration.
 *
 * `EmbedAutoSize` (decisions.md D-040) reports this page's height to its
 * host on every embed, not just ones injected by `/embed.js` — a host page
 * that hand-rolls the iframe snippet and wants to listen for the resize
 * message can do so unprompted.
 */
export default async function EmbedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  await getPublicEvent(eventSlug);

  return (
    <div className="min-h-full bg-background px-4 py-4">
      <EmbedAutoSize />
      {children}
    </div>
  );
}
