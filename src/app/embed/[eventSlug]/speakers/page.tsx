import { getGallery, getPublicEvent } from "@/app/p/[eventSlug]/data";
import { SpeakerGallery } from "@/app/p/[eventSlug]/speakers/speaker-gallery";

/** Chrome-less speaker gallery for iframing (spec.md "Important / strongly
 * desired": embeds). Same data + component as `/p/[eventSlug]/speakers`,
 * just without the page header/nav/footer. */
export default async function EmbedSpeakersPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const [event, speakers] = await Promise.all([getPublicEvent(eventSlug), getGallery(eventSlug)]);
  return <SpeakerGallery speakers={speakers} timezone={event.timezone} />;
}
