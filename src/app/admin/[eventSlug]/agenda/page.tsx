import { enumerateDays } from "@/domain/scheduling";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { loadSpeakerRoster } from "../speakers/roster";
import { AgendaBoard } from "./agenda-board";
import type { BoardPerson, BoardSession } from "./types";

/**
 * Agenda builder (spec.md §9): one day at a time, rooms across, time down,
 * with the unscheduled sessions in a tray beside the grid. Everything the
 * board needs is loaded here through the storage-agnostic repository layer and
 * handed to a client component; the writes go back through server actions in
 * ./actions.ts.
 *
 * Admin-only (decisions.md D-047) — building the schedule isn't part of a
 * reviewer's event workspace.
 */
export default async function AgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  /** `?session=<id>` deep-links straight into that session's edit dialog —
   * the submission detail page's "Edit title, abstract & track" link
   * (decisions.md D-054(5)). */
  searchParams: Promise<{ session?: string }>;
}) {
  const { eventSlug } = await params;
  const { session: focusSessionId } = await searchParams;
  const { user, event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const [sessions, rooms, tracks] = await Promise.all([
    repos.sessions.listByEvent(event.id),
    repos.rooms.listByEvent(event.id),
    repos.tracks.listByEvent(event.id),
  ]);

  // Speaker links for every session in one batch, then the people themselves.
  const links = await repos.sessions.listSpeakersBySessionIds(sessions.map((s) => s.id));
  const speakerIdsBySession = new Map<string, string[]>();
  for (const link of links) {
    speakerIdsBySession.set(link.sessionId, [
      ...(speakerIdsBySession.get(link.sessionId) ?? []),
      link.userId,
    ]);
  }

  const toPerson = (person: { id: string; name: string | null; email: string }): BoardPerson => ({
    id: person.id,
    name: person.name ?? person.email,
    email: person.email,
  });

  const [assigned, directory, roster] = await Promise.all([
    repos.users.listByIds([...new Set(links.map((l) => l.userId))]),
    repos.users.listByRole("speaker"),
    // Event-scoped, unlike `directory` above (every speaker in Greenroom) —
    // the session dialog's "add a speaker" only offers people already
    // associated with this event (decisions.md D-057), same source
    // Admin > Speakers reads.
    loadSpeakerRoster(repos, event.id),
  ]);
  const rosterSpeakers = roster.rollups.map((rollup) => rollup.speaker);

  const people: Record<string, BoardPerson> = {};
  for (const person of [...assigned, ...directory, ...rosterSpeakers]) {
    people[person.id] = toPerson(person);
  }

  const boardSessions: BoardSession[] = sessions.map((session) => ({
    ...session,
    speakerIds: speakerIdsBySession.get(session.id) ?? [],
  }));

  // Day tabs come from the event's own date range; if it has none yet, fall
  // back to whatever days already carry sessions so the board still works.
  const programmedDays = [...new Set(sessions.flatMap((s) => (s.day ? [s.day] : [])))].sort();
  const days = [
    ...new Set([...enumerateDays(event.startDate, event.endDate), ...programmedDays]),
  ].sort();
  if (days.length === 0) days.push(new Date().toISOString().slice(0, 10));

  return (
    <div>
      <PageHeader
        title="Agenda"
        description="Drag sessions from the tray onto a room and time. Conflicts are flagged, never blocked."
      />

      <AgendaBoard
        eventSlug={eventSlug}
        days={days}
        rooms={rooms}
        tracks={tracks}
        sessions={boardSessions}
        people={people}
        directory={directory.map(toPerson).sort((a, b) => a.name.localeCompare(b.name))}
        roster={rosterSpeakers.map(toPerson).sort((a, b) => a.name.localeCompare(b.name))}
        canEdit={user.role === "admin"}
        focusSessionId={focusSessionId}
      />
    </div>
  );
}
