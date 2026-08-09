"use client";

import { useCallback, useState } from "react";

/** Initials fallback for a missing or broken headshot — client-only because
 * it needs the image's `onError` to decide whether to fall back. */
export function SpeakerHeadshot({
  name,
  headshotUrl,
}: {
  name: string;
  headshotUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);

  // A broken <img> can finish loading — and fire its native `error` event —
  // before React hydrates and attaches `onError`: the browser doesn't wait
  // for the page to become interactive. Without this, a dead demo/R2 URL
  // (seed data uses several) renders as a permanently broken image icon
  // instead of the initials fallback. This ref callback runs the moment
  // React attaches to the element, so it catches an error that already
  // happened during SSR just as reliably as one that happens later.
  const checkAlreadyBroken = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) {
      setFailed(true);
    }
  }, []);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (!headshotUrl || failed) {
    return (
      <div
        aria-hidden
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent font-heading text-sm font-semibold text-accent-foreground"
      >
        {initials || "?"}
      </div>
    );
  }

  return (
    // External/demo headshot URLs (as well as /files/<key> ones) aren't known
    // to next/image ahead of time, and this is a small fixed-size avatar, not
    // an LCP asset.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={checkAlreadyBroken}
      src={headshotUrl}
      alt={name}
      className="size-12 shrink-0 rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
