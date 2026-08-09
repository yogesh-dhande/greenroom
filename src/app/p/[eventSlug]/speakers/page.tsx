import { getGallery } from "../data";
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
  const speakers = await getGallery(eventSlug);

  return (
    <div>
      <PageHeader
        title="Speakers"
        description="The confirmed lineup — updated as talks are accepted."
        action={<EmbedSnippet embedPath={`/embed/${eventSlug}/speakers`} />}
      />
      <SpeakerGallery speakers={speakers} />
    </div>
  );
}
