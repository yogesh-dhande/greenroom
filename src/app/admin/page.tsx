import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { listAccessibleEvents, requireAdminOrReviewer } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateRange } from "@/components/date-format";

/** Landing spot for /admin: every event this admin/reviewer can reach — all of
 * them for an admin, the ones they hold a track on for a reviewer (D-045) —
 * plus the obvious way to spin up a new one. Multi-event capable (spec.md §1). */
export default async function AdminIndexPage() {
  const user = await requireAdminOrReviewer("/admin");
  const events = await listAccessibleEvents(user);
  const canCreate = user.role === "admin";

  if (events.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">
        <PageHeader title="Greenroom" description="Welcome — let's get your first event set up." />
        <EmptyState
          title="No events yet"
          description={
            canCreate
              ? "Create an event to start building your call for speakers — name, dates, and timezone is all it takes to begin."
              : "You review by track: an admin gives you access to an event by assigning you one of its tracks."
          }
          action={
            canCreate ? (
              <Button asChild>
                <Link href="/admin/new">
                  <PlusIcon />
                  Create your first event
                </Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <PageHeader
        title="Your events"
        description="Pick an event to manage, or start a new one."
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/admin/new">
                <PlusIcon />
                New event
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3">
        {events.map((event) => (
          <Link key={event.id} href={`/admin/${event.slug}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle>{event.name}</CardTitle>
                <CardDescription>
                  {formatDateRange(event.startDate, event.endDate)}
                  {event.location ? ` · ${event.location}` : ""}
                </CardDescription>
              </CardHeader>
              {event.description && (
                <CardContent className="text-sm text-muted-foreground">
                  {event.description}
                </CardContent>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
