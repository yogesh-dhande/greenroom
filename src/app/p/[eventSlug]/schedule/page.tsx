import { getPublicEvent, getSchedule } from "../data";
import { EmbedSnippet } from "../embed-snippet";
import { PageHeader } from "@/components/page-header";
import { ScheduleView } from "./schedule-view";

/** Public schedule (spec.md "Important / strongly desired"): confirmed,
 * scheduled sessions only, day by day, in the event's own timezone
 * (questions.md Q6 working assumption). */
export default async function PublicSchedulePage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const [event, days] = await Promise.all([
    getPublicEvent(eventSlug),
    getSchedule(eventSlug),
  ]);

  return (
    <div>
      <PageHeader
        title="Schedule"
        description={`All times in ${event.timezone.replace("_", " ")}.`}
        action={<EmbedSnippet eventSlug={eventSlug} view="schedule" />}
      />
      <ScheduleView days={days} timezone={event.timezone} eventSlug={eventSlug} itinerary />
    </div>
  );
}
