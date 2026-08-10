import { getGallery, getPublicEvent } from "@/app/p/[eventSlug]/data";
import { ProgramComingSoon } from "@/app/p/[eventSlug]/program-coming-soon";
import { SpeakerGallery } from "@/app/p/[eventSlug]/speakers/speaker-gallery";
import {
  applyEmbedGalleryConfig,
  embedSearchParams,
  parseEmbedConfig,
  type EmbedSearchParams,
} from "@/domain/embed-config";
import { programVisible } from "@/domain/program-visibility";
import { EmbedFrame } from "../embed-frame";

/** Chrome-less speaker gallery for iframing (spec.md "Important / strongly
 * desired": embeds; decisions.md D-074). Same data + component as
 * `/p/[eventSlug]/speakers`, minus the page header/nav/footer, rendered with
 * the headshot-forward `variant="embed"` so the embed reads as a visually
 * distinct surface rather than the full page's content-heavy cards. */
export default async function EmbedSpeakersPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<EmbedSearchParams>;
}) {
  const { eventSlug } = await params;
  const config = parseEmbedConfig(embedSearchParams(await searchParams));
  const [event, speakers] = await Promise.all([getPublicEvent(eventSlug), getGallery(eventSlug)]);
  // Same publish gate as the chrome'd gallery (decisions.md D-056).
  if (!programVisible(event)) return <ProgramComingSoon eventName={event.name} />;
  const configuredSpeakers = applyEmbedGalleryConfig(speakers, config);
  return (
    <EmbedFrame config={config}>
      <SpeakerGallery
        speakers={configuredSpeakers}
        timezone={event.timezone}
        variant={config.widget === "speakers" ? "full" : "embed"}
      />
    </EmbedFrame>
  );
}
