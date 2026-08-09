/**
 * Chrome-less 404 for an embed pointed at an unknown event slug — kept
 * minimal since this renders inside a third-party page's iframe.
 *
 * Lives in `src/app/embed/` rather than `src/app/embed/[eventSlug]/`, one
 * level up from the layout that calls `notFound()` — see the longer note in
 * `src/app/p/not-found.tsx` for why a segment's own layout isn't caught by a
 * not-found.tsx placed next to it.
 */
export default function EmbedNotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">This event can&apos;t be found.</p>
    </div>
  );
}
