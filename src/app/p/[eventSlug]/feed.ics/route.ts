import { getSchedule } from "../data";
import { scheduleFeedEntries } from "@/domain/program";
import { programVisible } from "@/domain/program-visibility";
import { buildEmptyCalendar, buildItineraryCalendar } from "@/lib/ics";
import { getRepos } from "@/lib/db";
import { applyEmbedScheduleConfig, parseEmbedConfig } from "@/domain/embed-config";

/**
 * Public iCal feed of every approved, scheduled session (spec.md "embeddable
 * on an external website"; decisions.md D-040). Distinct from
 * ../itinerary.ics/route.ts, which exports one *visitor's* starred subset —
 * this is the whole public schedule, for a calendar app or an embedding site
 * to subscribe to. Reuses `buildItineraryCalendar` (src/lib/ics.ts):
 * METHOD:PUBLISH, one VEVENT per session, no organizer/attendees — exactly
 * the shape a "here is an event" feed needs, and UTC-instant `DTSTART`/`DTEND`
 * per that module's header comment (no VTIMEZONE, so UTC is the only
 * representation every client resolves identically — see docs/learnings.md
 * on the `ics` package's timezone story).
 *
 * Same repo-first 404 pattern as feed.json/route.ts and
 * ../itinerary.ics/route.ts. Deliberately unauthenticated and CORS-open.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventSlug: string }> },
): Promise<Response> {
  const { eventSlug } = await params;

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return new Response("Not found", { status: 404 });

  const naming = {
    calendarName: `${event.name} — schedule`,
    filenameBase: `${eventSlug}-schedule`,
  };

  // Unpublished (decisions.md D-056): an event-less but well-formed calendar,
  // never a 404 — a client subscribed to this URL before the program went
  // live would otherwise report the subscription as broken and may stop
  // polling it altogether.
  if (!programVisible(event)) {
    return icsResponse(buildEmptyCalendar(naming));
  }

  const config = parseEmbedConfig(new URL(request.url).searchParams);
  const days = applyEmbedScheduleConfig(await getSchedule(eventSlug), config);
  const entries = scheduleFeedEntries(days);
  // Published, but nothing is on the agenda yet (or everything is still held
  // back by content status). Same empty-but-valid calendar as the unpublished
  // case above, for the same reason: a subscribed client must see an empty
  // programme, not a broken subscription.
  if (entries.length === 0) {
    return icsResponse(buildEmptyCalendar(naming));
  }

  return icsResponse(
    buildItineraryCalendar({
      timeZone: event.timezone,
      ...naming,
      entries,
    }),
  );
}

function icsResponse(calendar: { content: string; contentType: string }): Response {
  return new Response(calendar.content, {
    headers: {
      "content-type": calendar.contentType,
      "access-control-allow-origin": "*",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
