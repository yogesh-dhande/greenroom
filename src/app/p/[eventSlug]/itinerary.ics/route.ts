import { getSchedule } from "../data";
import { itinerarySessions, speakerAffiliationLabel } from "@/domain/program";
import { buildItineraryCalendar } from "@/lib/ics";
import { getRepos } from "@/lib/db";

/**
 * Downloads an attendee's starred sessions as a single .ics (spec.md "Public
 * program depth" / decisions.md D-031: personal itinerary with calendar
 * export).
 *
 * The selection travels in the query string (`?s=<id>,<id>` — repeated `s`
 * params work too) rather than in a body, because the schedule page renders
 * this as an ordinary download link built from localStorage: no account, no
 * server-side itinerary state, and the resulting URL is shareable.
 *
 * Building the file here rather than in the browser keeps src/lib/ics.ts the
 * only module that knows how to write iCalendar (decisions.md D-003, D-008)
 * and keeps the `ics` package out of the public page's JS bundle. Ids are
 * resolved against the *public* schedule, so an id for a cancelled, draft or
 * other event's session simply doesn't come back — the URL can't be used to
 * read anything the page wouldn't already show. Deliberately unauthenticated,
 * like the rest of `/p/[eventSlug]`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventSlug: string }> },
): Promise<Response> {
  const { eventSlug } = await params;

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return new Response("Not found", { status: 404 });

  const requested = new URL(request.url).searchParams
    .getAll("s")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const days = await getSchedule(eventSlug);
  const sessions = itinerarySessions(days, requested);
  if (sessions.length === 0) {
    return new Response("Star at least one session to export a calendar.", { status: 400 });
  }

  const calendar = buildItineraryCalendar({
    timeZone: event.timezone,
    calendarName: `${event.name} — my schedule`,
    filenameBase: `${eventSlug}-my-schedule`,
    entries: sessions.map((session) => ({
      sessionId: session.id,
      title: session.title,
      description: session.description,
      // Same speaker line as the public feed (spec.md "Public program depth":
      // session surfaces, feeds included, carry name/title/company).
      speakers: session.speakers.map(speakerAffiliationLabel),
      location: session.roomName,
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
    })),
  });

  return new Response(calendar.content, {
    headers: {
      "content-type": calendar.contentType,
      "content-disposition": `attachment; filename="${calendar.filename}"`,
      // The starred set is per visitor and changes as they star/unstar.
      "cache-control": "no-store",
    },
  });
}
