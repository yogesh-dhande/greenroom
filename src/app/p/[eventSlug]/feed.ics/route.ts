import { getSchedule } from "../data";
import { scheduleFeedEntries } from "@/domain/program";
import { buildItineraryCalendar } from "@/lib/ics";
import { getRepos } from "@/lib/db";

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
  _request: Request,
  { params }: { params: Promise<{ eventSlug: string }> },
): Promise<Response> {
  const { eventSlug } = await params;

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return new Response("Not found", { status: 404 });

  const days = await getSchedule(eventSlug);
  const entries = scheduleFeedEntries(days);
  if (entries.length === 0) {
    return new Response("No sessions scheduled yet.", { status: 404 });
  }

  const calendar = buildItineraryCalendar({
    timeZone: event.timezone,
    calendarName: `${event.name} — schedule`,
    filenameBase: `${eventSlug}-schedule`,
    entries,
  });

  return new Response(calendar.content, {
    headers: {
      "content-type": calendar.contentType,
      "access-control-allow-origin": "*",
      "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
