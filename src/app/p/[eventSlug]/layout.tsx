import Link from "next/link";
import { getPublicEvent } from "./data";
import { PublicNav } from "./public-nav";

/**
 * Chrome for the public program (spec.md "Important / strongly desired"):
 * event identity + a small nav between overview/speakers/schedule. No auth —
 * this whole subtree is the public, view-only surface (spec.md's "public
 * attendee" user). `getPublicEvent` 404s for an unknown slug, caught by the
 * sibling not-found.tsx.
 */
export default async function PublicEventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const event = await getPublicEvent(eventSlug);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Link href={`/p/${eventSlug}`} className="flex flex-col leading-tight">
            <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
              Greenroom
            </span>
            <span className="font-heading text-base font-semibold text-foreground">
              {event.name}
            </span>
          </Link>
          <PublicNav eventSlug={eventSlug} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Public program for {event.name}.
      </footer>
    </div>
  );
}
