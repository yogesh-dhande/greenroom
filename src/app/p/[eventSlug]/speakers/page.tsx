import { getGallery, getPublicEvent } from "../data";
import { EmbedSnippet } from "../embed-snippet";
import { PageHeader } from "@/components/page-header";
import { SpeakerGallery } from "./speaker-gallery";

/** Public speaker gallery (spec.md "Important / strongly desired"). */
export default async function PublicSpeakersPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const [event, speakers] = await Promise.all([getPublicEvent(eventSlug), getGallery(eventSlug)]);

  return (
    <div>
      <PageHeader
        title="Speakers"
        description="The confirmed lineup — updated as talks are accepted."
        action={<EmbedSnippet eventSlug={eventSlug} view="speakers" />}
      />
      <SpeakerGallery speakers={speakers} timezone={event.timezone} />
    </div>
  );
}
