import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { requireEventAdmin } from "@/lib/session";
import { AirtableSyncCard } from "./airtable-sync-card";
import { EventDetailsForm } from "./event-details-form";
import { TracksManager } from "./tracks-manager";
import { RoomsManager } from "./rooms-manager";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  // Event configuration is organizer-only (decisions.md D-047): reviewers get
  // the rest of /admin but are bounced back to the overview here.
  const { event } = await requireEventAdmin(eventSlug);
  const repos = await getRepos();

  const [tracks, rooms] = await Promise.all([
    repos.tracks.listByEvent(event.id),
    repos.rooms.listByEvent(event.id),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Event identity, dates, tracks, rooms, and integrations."
      />

      <Card>
        <CardHeader>
          <CardTitle>Event details</CardTitle>
          <CardDescription>Name, URL, dates, timezone, and location.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventDetailsForm event={event} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracks</CardTitle>
          <CardDescription>
            Content areas submissions are grouped into (e.g. &quot;AI Engineering&quot;).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TracksManager eventSlug={eventSlug} eventId={event.id} tracks={tracks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rooms</CardTitle>
          <CardDescription>Physical or virtual spaces sessions can be scheduled into.</CardDescription>
        </CardHeader>
        <CardContent>
          <RoomsManager eventSlug={eventSlug} eventId={event.id} rooms={rooms} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Airtable sync</CardTitle>
          <CardDescription>
            A one-way copy of this event in Airtable, for reporting and row-triggered automations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AirtableSyncCard eventSlug={eventSlug} />
        </CardContent>
      </Card>
    </div>
  );
}
