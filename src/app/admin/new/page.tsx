import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { NewEventForm } from "./new-event-form";

export default async function NewEventPage() {
  await requireAdmin("/admin/new");

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
        <Link href="/admin">
          <ArrowLeftIcon />
          All events
        </Link>
      </Button>
      <PageHeader
        title="Create an event"
        description="Basic identity and dates — you can add tracks, rooms, and everything else once it's created."
      />
      <Card>
        <CardContent>
          <NewEventForm />
        </CardContent>
      </Card>
    </div>
  );
}
