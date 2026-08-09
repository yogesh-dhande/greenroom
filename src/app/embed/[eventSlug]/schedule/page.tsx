import { getPublicEvent, getSchedule } from "@/app/p/[eventSlug]/data";
import { ProgramComingSoon } from "@/app/p/[eventSlug]/program-coming-soon";
import { ScheduleView } from "@/app/p/[eventSlug]/schedule/schedule-view";
import { programVisible } from "@/domain/program-visibility";

/** Chrome-less schedule for iframing (spec.md "Important / strongly
 * desired": embeds). Same data + component as `/p/[eventSlug]/schedule`,
 * just without the page header/nav/footer. */
export default async function EmbedSchedulePage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const [event, days] = await Promise.all([
    getPublicEvent(eventSlug),
    getSchedule(eventSlug),
  ]);
  // A host page that embedded the schedule early keeps rendering something
  // sensible until the organizer publishes (decisions.md D-056).
  if (!programVisible(event)) return <ProgramComingSoon eventName={event.name} />;
  // No itinerary here: starring belongs to the attendee's own visit to
  // /p/[eventSlug], not to a third-party page that iframes the programme.
  // Search, facets and the session detail view all work unchanged.
  return <ScheduleView days={days} timezone={event.timezone} eventSlug={eventSlug} />;
}
