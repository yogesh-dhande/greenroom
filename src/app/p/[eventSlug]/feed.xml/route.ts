import { getGallery, getSchedule } from "../data";
import {
  buildProgramFeed,
  resolveFeedAssetUrl,
} from "@/domain/program";
import {
  applyEmbedGalleryConfig,
  applyEmbedScheduleConfig,
  parseEmbedConfig,
} from "@/domain/embed-config";
import { buildProgramXml } from "@/domain/program-xml";
import { getRepos } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventSlug: string }> },
): Promise<Response> {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return new Response("Not found", { status: 404 });

  const config = parseEmbedConfig(new URL(request.url).searchParams);
  const [days, speakers] = await Promise.all([getSchedule(eventSlug), getGallery(eventSlug)]);
  const feed = buildProgramFeed(
    event,
    applyEmbedScheduleConfig(days, config),
    applyEmbedGalleryConfig(speakers, config),
  );
  const origin = new URL(request.url).origin;
  feed.speakers = feed.speakers.map((speaker) => ({
    ...speaker,
    headshotUrl: resolveFeedAssetUrl(origin, speaker.headshotUrl),
  }));

  return new Response(buildProgramXml(feed), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
