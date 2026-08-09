import Link from "next/link";

/**
 * Friendly 404 for an unknown/mistyped event slug on the public program — a
 * visitor following a bad link sees this instead of the framework default.
 *
 * Deliberately placed one level up, in `src/app/p/` rather than
 * `src/app/p/[eventSlug]/`: `notFound()` is called from
 * `[eventSlug]/layout.tsx` (via `getPublicEvent`), and Next.js's not-found
 * boundary for a segment wraps that segment's *children* — it does not catch
 * a `notFound()` thrown by the segment's own layout. A `not-found.tsx`
 * sitting next to that layout would only ever catch a `notFound()` thrown
 * from `page.tsx` below it, so the boundary has to live in the parent
 * segment instead.
 */
export default function PublicEventNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        Greenroom
      </p>
      <h1 className="mt-2 font-heading text-2xl font-semibold text-foreground">
        We can&apos;t find that event
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The link may be out of date, or the event may not be public yet.
      </p>
      <Link
        href="/"
        className="mt-6 text-sm font-medium text-primary underline underline-offset-4"
      >
        Go to Greenroom
      </Link>
    </div>
  );
}
