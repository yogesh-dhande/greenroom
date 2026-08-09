import { getPublicEvent, getSchedule } from "@/app/p/[eventSlug]/data";
import { ScheduleView } from "@/app/p/[eventSlug]/schedule/schedule-view";

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
  return <ScheduleView days={days} timezone={event.timezone} />;
}
