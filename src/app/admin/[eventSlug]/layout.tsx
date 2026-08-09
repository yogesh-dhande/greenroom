import Link from "next/link";
import { listAccessibleEvents, requireEventAccess } from "@/lib/session";
import { AdminNav } from "@/components/admin-nav";
import { EventSwitcher } from "@/components/event-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { formatDateRange } from "@/components/date-format";

/**
 * Event-scoped admin chrome: sticky top bar (wordmark, event switcher,
 * signed-in user + sign out) and the left nav, wrapped around every
 * /admin/[eventSlug]/* page.
 *
 * Also the outer half of the event-scoped guard (decisions.md D-045): a
 * reviewer with no track on this event never renders a child page, and the
 * switcher only offers events they can actually open.
 */
export default async function EventAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { user, event } = await requireEventAccess(eventSlug);
  const events = await listAccessibleEvents(user);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="px-1 text-sm font-semibold tracking-tight text-foreground"
          >
            Greenroom
          </Link>
          <span className="text-muted-foreground">/</span>
          <EventSwitcher
            events={events.map((e) => ({ slug: e.slug, name: e.name }))}
            currentSlug={eventSlug}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border">
          <div className="px-4 pt-4 pb-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Event
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">
              {event.name}
            </p>
            <p className="text-xs text-muted-foreground">{formatDateRange(event.startDate, event.endDate)}</p>
          </div>
          <AdminNav eventSlug={eventSlug} role={user.role} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
