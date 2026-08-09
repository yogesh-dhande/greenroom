import { getGallery, getPublicEvent } from "@/app/p/[eventSlug]/data";
import { ProgramComingSoon } from "@/app/p/[eventSlug]/program-coming-soon";
import { SpeakerGallery } from "@/app/p/[eventSlug]/speakers/speaker-gallery";
import { programVisible } from "@/domain/program-visibility";

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
  // Same publish gate as the chrome'd gallery (decisions.md D-056).
  if (!programVisible(event)) return <ProgramComingSoon eventName={event.name} />;
  return <SpeakerGallery speakers={speakers} timezone={event.timezone} />;
}
