import { getPublicEvent, getSchedule } from "@/app/p/[eventSlug]/data";
import { ProgramComingSoon } from "@/app/p/[eventSlug]/program-coming-soon";
import { ScheduleView } from "@/app/p/[eventSlug]/schedule/schedule-view";
import {
  applyEmbedScheduleConfig,
  embedSearchParams,
  parseEmbedConfig,
  type EmbedSearchParams,
} from "@/domain/embed-config";
import { programVisible } from "@/domain/program-visibility";
import { EmbedFrame } from "../embed-frame";
import { SessionList } from "./session-list";

/** Chrome-less schedule for iframing (spec.md "Important / strongly
 * desired": embeds). Same data + component as `/p/[eventSlug]/schedule`,
 * just without the page header/nav/footer. */
export default async function EmbedSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<EmbedSearchParams>;
}) {
  const { eventSlug } = await params;
  const config = parseEmbedConfig(embedSearchParams(await searchParams));
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
  const configuredDays = applyEmbedScheduleConfig(days, config);
  return (
    <EmbedFrame config={config}>
      {config.widget === "sessions" ? (
        <SessionList days={configuredDays} timezone={event.timezone} />
      ) : (
        <ScheduleView
          days={configuredDays}
          timezone={event.timezone}
          eventSlug={eventSlug}
          itinerary={config.widget === "itinerary"}
        />
      )}
    </EmbedFrame>
  );
}
