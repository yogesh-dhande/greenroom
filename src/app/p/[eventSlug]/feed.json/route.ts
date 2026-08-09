import { getGallery, getSchedule } from "../data";
import { buildProgramFeed, resolveFeedAssetUrl } from "@/domain/program";
import { getRepos } from "@/lib/db";

/**
 * Public JSON feed of the event's approved program (spec.md "embeddable on
 * an external website"; decisions.md D-040 — the "apps or databases"
 * consumer Sessionboard serves with JSON, alongside iCal and the one-line JS
 * embed; XML is deliberately dropped, see D-040's trade-off table).
 *
 * Built from the exact same loaders the public HTML pages use
 * (`getSchedule`/`getGallery`), so this can never show a session or speaker
 * the pages themselves wouldn't: confirmed-and-scheduled sessions only, and
 * speaker names/bios with no email or internal id anywhere in the payload.
 * Deliberately unauthenticated and CORS-open — it's public, read-only
 * program data meant to be fetched cross-origin by whatever is embedding it.
 *
 * Looks up the event via the repo directly (not `getPublicEvent`, which
 * calls Next's `notFound()` — appropriate in a page render, not in a route
 * handler) so an unknown slug gets a plain 404 Response, mirroring
 * ../itinerary.ics/route.ts.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventSlug: string }> },
): Promise<Response> {
  const { eventSlug } = await params;

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return new Response("Not found", { status: 404 });

  const [days, speakers] = await Promise.all([getSchedule(eventSlug), getGallery(eventSlug)]);
  const feed = buildProgramFeed(event, days, speakers);

  const origin = new URL(request.url).origin;
  feed.speakers = feed.speakers.map((speaker) => ({
    ...speaker,
    headshotUrl: resolveFeedAssetUrl(origin, speaker.headshotUrl),
  }));

  return new Response(JSON.stringify(feed, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      // Public program data that changes as sessions are scheduled/approved —
      // a short shared cache keeps embeds fast without going stale for long.
      "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
