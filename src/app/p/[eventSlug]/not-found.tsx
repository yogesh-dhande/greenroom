"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 404 for a valid event with an unknown sub-path (e.g. /p/<slug>/gallery) —
 * this file sits next to `layout.tsx`, so it renders as that layout's
 * `children` and keeps the event's own header/nav/footer around it, instead
 * of falling through to the chrome-less app-wide not-found.tsx.
 *
 * Paired with `[...rest]/page.tsx`, which calls `notFound()` so an otherwise
 * unmatched sub-path still resolves to *this* segment (and this layout)
 * rather than bubbling straight past it.
 *
 * `not-found.js` files receive no props (not even `params`), so the event
 * slug for the "back to program" link is read from the URL client-side
 * instead.
 */
export default function EventNotFound() {
  const pathname = usePathname();
  const eventSlug = pathname?.split("/")[2];
  const programHref = eventSlug ? `/p/${eventSlug}` : "/";

  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        404
      </p>
      <h1 className="mt-2 font-heading text-2xl font-semibold text-foreground">
        Page not found
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        That page doesn&apos;t exist for this event.
      </p>
      <Link
        href={programHref}
        className="mt-6 text-sm font-medium text-primary underline underline-offset-4"
      >
        Back to the program
      </Link>
    </div>
  );
}
