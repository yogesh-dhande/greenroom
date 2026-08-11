import { notFound } from "next/navigation";

/**
 * Catch-all for any sub-path under a valid event slug that isn't a real page
 * (typos and retired links such as /p/<slug>/sessions). With no
 * page.tsx matching, Next.js would otherwise skip this segment entirely and
 * fall through to the chrome-less app-wide not-found.tsx; matching here (and
 * immediately calling `notFound()`) makes this segment's own not-found.tsx —
 * which keeps the event's header/nav/footer — the one that renders instead.
 */
export default function EventCatchAll() {
  notFound();
}
