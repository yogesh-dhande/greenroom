/**
 * Public program domain service — the pure grouping/dedup logic behind the
 * public speaker gallery and schedule (spec.md "Important / strongly
 * desired"; decisions.md D-025 §4: cancelled sessions are stood down and
 * never shown as programmed). No datastore imports — callers (the /p and
 * /embed routes) fetch Session/Track/Room/User rows via src/db/repos/* and
 * pass plain entities/lookup maps in.
 */
import type { Session } from "@/db/entities";
import { minutesOfDay } from "@/domain/scheduling";
import type { ItineraryEntry } from "@/lib/ics";

export interface SessionWithSpeakers extends Session {
  speakerIds: string[];
}

// ---------------------------------------------------------------------------
// Visibility rules
// ---------------------------------------------------------------------------

/** A cancelled session is stood down — it must never appear in a public
 * view, scheduled or not (decisions.md D-025 §4). */
export function isPubliclyVisible(session: Pick<Session, "status">): boolean {
  return session.status === "confirmed";
}

/**
 * Sessions eligible for the public speaker gallery: any non-cancelled
 * confirmed session, scheduled or not. Conferences routinely announce a
 * speaker lineup before the full timetable is locked in, so a session
 * waiting in the agenda's parking lot still counts as an "accepted" talk.
 */
export function gallerySessions<T extends Pick<Session, "status">>(sessions: T[]): T[] {
  return sessions.filter(isPubliclyVisible);
}

/** A session ready to print on the public schedule: confirmed, and placed
 * on the agenda (day + both times set). Mirrors entities.ts `isScheduled`,
 * generic so callers can pass the richer SessionWithSpeakers shape. */
function isPlacedOnAgenda<T extends Pick<Session, "day" | "startTime" | "endTime">>(
  session: T,
): boolean {
  return Boolean(session.day && session.startTime && session.endTime);
}

/**
 * Sessions eligible for the public schedule: confirmed AND scheduled.
 * Draft, unscheduled, and cancelled sessions are never shown as programmed
 * (decisions.md D-025 §4) — they stay invisible rather than appearing with
 * a placeholder time.
 */
export function scheduleSessions<
  T extends Pick<Session, "status" | "day" | "startTime" | "endTime">,
>(sessions: T[]): T[] {
  return sessions.filter((s) => isPubliclyVisible(s) && isPlacedOnAgenda(s));
}

// ---------------------------------------------------------------------------
// Speaker gallery: dedup a speaker across every talk they're on
// ---------------------------------------------------------------------------

/** Just enough of a person to render a gallery card. */
export interface ProgramPerson {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
  /**
   * Speaker-maintained profile links (spec.md §6), rendered on the card by
   * `profileLinks` in src/domain/profile.ts. Optional because a person with no
   * links is the common case and because the gallery grouping below is pure
   * pass-through — a caller that doesn't collect them simply gets a card with
   * no link row.
   */
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
}

export interface GalleryTalk {
  sessionId: string;
  title: string;
  /** Scheduling detail, so a speaker's detail view can answer "when and
   * where?" without a second query. Null while the talk is still in the
   * agenda's parking lot. */
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  roomName: string | null;
  trackName: string | null;
}

export interface GallerySpeaker extends ProgramPerson {
  talks: GalleryTalk[];
}

/** Track/room names for the talk rows on a speaker card. Optional because a
 * caller that only needs titles (an early lineup announcement) can skip the
 * extra lookups; the rows then render without a room/track. */
export interface GalleryLookups {
  trackById?: Map<string, { name: string }>;
  roomById?: Map<string, { name: string }>;
}

/**
 * One card per speaker, even when they co-present or have multiple accepted
 * talks — each talk title is collected onto that one card rather than
 * printing the same person twice. Speakers with no entry in `people` (e.g. a
 * stale link) are skipped rather than rendered with blanks. Sorted by surname
 * (see `compareBySurname`) so the directory reads like a delegate list.
 */
export function buildGallery(
  sessions: SessionWithSpeakers[],
  people: Map<string, ProgramPerson>,
  lookups: GalleryLookups = {},
): GallerySpeaker[] {
  const bySpeaker = new Map<string, GallerySpeaker>();

  for (const session of gallerySessions(sessions)) {
    for (const speakerId of session.speakerIds) {
      const person = people.get(speakerId);
      if (!person) continue;

      const talk: GalleryTalk = {
        sessionId: session.id,
        title: session.title,
        day: session.day,
        startTime: session.startTime,
        endTime: session.endTime,
        roomName: (session.roomId ? lookups.roomById?.get(session.roomId)?.name : null) ?? null,
        trackName: (session.trackId ? lookups.trackById?.get(session.trackId)?.name : null) ?? null,
      };
      const existing = bySpeaker.get(speakerId);
      if (existing) {
        existing.talks.push(talk);
      } else {
        bySpeaker.set(speakerId, { ...person, talks: [talk] });
      }
    }
  }

  for (const speaker of bySpeaker.values()) {
    // Scheduled talks first, in the order the attendee will see them; the
    // still-unplaced ones trail behind rather than sorting to the top.
    speaker.talks.sort((a, b) => {
      if (a.day && b.day && a.day !== b.day) return a.day.localeCompare(b.day);
      if (a.day && !b.day) return -1;
      if (!a.day && b.day) return 1;
      if (a.startTime && b.startTime && a.startTime !== b.startTime) {
        return minutesOfDay(a.startTime) - minutesOfDay(b.startTime);
      }
      return a.title.localeCompare(b.title);
    });
  }

  return [...bySpeaker.values()].sort(compareBySurname);
}

// ---------------------------------------------------------------------------
// Schedule: sessions -> days -> time slots
// ---------------------------------------------------------------------------

export interface ScheduleSessionView {
  id: string;
  title: string;
  description: string | null;
  /** "YYYY-MM-DD" — carried on the session itself (not just its enclosing
   * `ScheduleDay`) so a detail view or a personal itinerary can render the
   * full date after the day grouping has been flattened away. */
  day: string;
  startTime: string;
  endTime: string;
  trackName: string | null;
  trackColor: string | null;
  roomName: string | null;
  /** Derived from the duration — see `sessionFormatLabel`. */
  formatLabel: string;
  speakerNames: string[];
}

/** Sessions sharing one exact day + time range — a conference's "10:00 AM"
 * row, which may hold several parallel talks across different rooms. */
export interface ScheduleSlot {
  startTime: string;
  endTime: string;
  sessions: ScheduleSessionView[];
}

export interface ScheduleDay {
  day: string;
  slots: ScheduleSlot[];
}

export interface ScheduleLookups {
  trackById: Map<string, { name: string; color: string | null }>;
  roomById: Map<string, { name: string }>;
  /** Display name per speaker id (already resolved to "name or email"). */
  speakerNameById: Map<string, string>;
}

/**
 * Groups schedulable sessions (see `scheduleSessions`) into day-by-day,
 * time-ordered slots, each carrying the room/track/speaker labels the public
 * schedule shows. Days are sorted chronologically ("YYYY-MM-DD" sorts
 * lexically); within a day, sessions are ordered by start time and then by
 * room name so a slot with several parallel talks reads consistently.
 */
export function buildSchedule(
  sessions: SessionWithSpeakers[],
  lookups: ScheduleLookups,
): ScheduleDay[] {
  const eligible = scheduleSessions(sessions) as Array<
    SessionWithSpeakers & { day: string; startTime: string; endTime: string }
  >;

  const byDay = new Map<string, ScheduleSessionView[]>();
  for (const session of eligible) {
    const track = session.trackId ? lookups.trackById.get(session.trackId) : undefined;
    const room = session.roomId ? lookups.roomById.get(session.roomId) : undefined;
    const view: ScheduleSessionView = {
      id: session.id,
      title: session.title,
      description: session.description,
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
      trackName: track?.name ?? null,
      trackColor: track?.color ?? null,
      roomName: room?.name ?? null,
      formatLabel: sessionFormatLabel(session.startTime, session.endTime),
      speakerNames: session.speakerIds
        .map((id) => lookups.speakerNameById.get(id))
        .filter((name): name is string => Boolean(name)),
    };
    const list = byDay.get(session.day) ?? [];
    list.push(view);
    byDay.set(session.day, list);
  }

  return [...byDay.keys()].sort().map((day) => {
    const dayItems = byDay.get(day)!;
    dayItems.sort((a, b) => {
      const byStart = minutesOfDay(a.startTime) - minutesOfDay(b.startTime);
      if (byStart !== 0) return byStart;
      return (a.roomName ?? "").localeCompare(b.roomName ?? "");
    });

    const slots: ScheduleSlot[] = [];
    for (const item of dayItems) {
      const currentSlot = slots.at(-1);
      if (
        currentSlot &&
        currentSlot.startTime === item.startTime &&
        currentSlot.endTime === item.endTime
      ) {
        currentSlot.sessions.push(item);
      } else {
        slots.push({ startTime: item.startTime, endTime: item.endTime, sessions: [item] });
      }
    }
    return { day, slots };
  });
}

// ---------------------------------------------------------------------------
// Browsing the program: search, facets, ordering (spec.md "Public program
// depth", decisions.md D-031). Everything below is pure and operates on the
// already-built `ScheduleDay[]` / `GallerySpeaker[]` views, so the public
// pages can stay statically rendered and filter in the browser rather than
// round-tripping to the server for every keystroke.
// ---------------------------------------------------------------------------

/**
 * Case- and accent-insensitive comparison key. Attendees type "Fernandez"
 * looking for "Luis Fernández", and a search box that misses that reads as
 * broken. NFD splits a letter from its combining marks, which the range below
 * then drops (a literal range rather than `\p{Diacritic}`, which needs an
 * ES2018 target — tsconfig pins ES2017).
 */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Name particles and honorific suffixes that are not the sortable surname. */
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "md", "mba"]);

/**
 * The token a directory sorts on: the last name part, ignoring a trailing
 * honorific ("Ada Lovelace Jr." sorts under L). Not a general-purpose name
 * parser — no attempt is made at "van der Berg" or at cultures that lead with
 * the family name; those still land somewhere deterministic, which is what
 * the alphabetical directory needs.
 */
export function surnameKey(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(foldText(parts[parts.length - 1]))) {
    parts.pop();
  }
  return foldText(parts[parts.length - 1] ?? name);
}

/** Alphabetical by surname, then by full name so co-surnames are stable. */
export function compareBySurname(a: { name: string }, b: { name: string }): number {
  const bySurname = surnameKey(a.name).localeCompare(surnameKey(b.name));
  return bySurname !== 0 ? bySurname : foldText(a.name).localeCompare(foldText(b.name));
}

/**
 * The session "format", derived from its placed duration rather than stored:
 * a session row has no format column (the CFP asks for one as a form answer,
 * which never becomes structured session data). The labels match the seeded
 * CFP's own vocabulary — "30-minute talk", "90-minute workshop" — so the
 * facet reads like the organizer's own language.
 */
export function sessionFormatLabel(startTime: string, endTime: string): string {
  const minutes = Math.max(0, minutesOfDay(endTime) - minutesOfDay(startTime));
  return `${minutes}-minute ${minutes >= 90 ? "workshop" : "talk"}`;
}

/** Sentinel for "no facet chosen" — a `<Select>` cannot hold an empty value. */
export const ANY_FACET = "all";

export interface ScheduleFilters {
  /** Free text, matched against session titles AND speaker names. */
  query?: string;
  track?: string;
  room?: string;
  format?: string;
}

/**
 * Keyword match over a session: title and speaker names, plus the track and
 * room labels so a search for "Main Stage" also does something sensible.
 * Multi-word queries are AND-ed term by term, so "priya retrieval" finds the
 * talk without the words having to be adjacent.
 */
export function sessionMatchesQuery(
  session: Pick<ScheduleSessionView, "title" | "speakerNames" | "trackName" | "roomName">,
  query: string,
): boolean {
  const terms = foldText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = foldText(
    [session.title, ...session.speakerNames, session.trackName, session.roomName]
      .filter(Boolean)
      .join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

/** Query + facets together. A facet left at `ANY_FACET` (or unset) is ignored. */
export function sessionMatchesFilters(
  session: ScheduleSessionView,
  filters: ScheduleFilters,
): boolean {
  const facet = (chosen: string | undefined, actual: string | null): boolean =>
    !chosen || chosen === ANY_FACET || chosen === actual;
  return (
    sessionMatchesQuery(session, filters.query ?? "") &&
    facet(filters.track, session.trackName) &&
    facet(filters.room, session.roomName) &&
    facet(filters.format, session.formatLabel)
  );
}

/**
 * Narrows a built schedule to the matching sessions, dropping slots and whole
 * days that end up empty — a day tab with nothing behind it is worse than no
 * tab at all.
 */
export function filterScheduleDays(days: ScheduleDay[], filters: ScheduleFilters): ScheduleDay[] {
  return days
    .map((day) => ({
      day: day.day,
      slots: day.slots
        .map((slot) => ({
          ...slot,
          sessions: slot.sessions.filter((session) => sessionMatchesFilters(session, filters)),
        }))
        .filter((slot) => slot.sessions.length > 0),
    }))
    .filter((day) => day.slots.length > 0);
}

/** Every session across every day, already in day + start-time order. */
export function flattenSchedule(days: ScheduleDay[]): ScheduleSessionView[] {
  return days.flatMap((day) => day.slots.flatMap((slot) => slot.sessions));
}

/** How many sessions a (possibly filtered) schedule holds — the result count. */
export function countScheduleSessions(days: ScheduleDay[]): number {
  return flattenSchedule(days).length;
}

export interface ScheduleFacetOptions {
  tracks: string[];
  rooms: string[];
  formats: string[];
}

/** The distinct facet values actually present on the schedule, so the filter
 * dropdowns never offer a choice that matches nothing. */
export function scheduleFacetOptions(days: ScheduleDay[]): ScheduleFacetOptions {
  const tracks = new Set<string>();
  const rooms = new Set<string>();
  const formats = new Set<string>();
  for (const session of flattenSchedule(days)) {
    if (session.trackName) tracks.add(session.trackName);
    if (session.roomName) rooms.add(session.roomName);
    formats.add(session.formatLabel);
  }
  const alphabetical = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  return {
    tracks: alphabetical(tracks),
    rooms: alphabetical(rooms),
    // Shortest first: "30-minute talk" before "90-minute workshop".
    formats: [...formats].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
  };
}

// ---------------------------------------------------------------------------
// Personal itinerary (spec.md "Public program depth"): the attendee's starred
// sessions. The selection itself is a list of session ids held in the
// browser's localStorage — no account, no server state (decisions.md D-031's
// public-widget scope is view-only).
// ---------------------------------------------------------------------------

/** localStorage key, namespaced per event so two events never share stars. */
export function itineraryStorageKey(eventSlug: string): string {
  return `greenroom:itinerary:${eventSlug}`;
}

/**
 * The starred sessions in the order they happen. Ids that no longer resolve
 * to a public session (a talk cancelled after it was starred) simply drop
 * out — the stored list is a wish, the schedule is the truth.
 */
export function itinerarySessions(
  days: ScheduleDay[],
  starredIds: readonly string[],
): ScheduleSessionView[] {
  const starred = new Set(starredIds);
  return flattenSchedule(days).filter((session) => starred.has(session.id));
}

/** Toggling a star, as a pure operation on the stored id list. */
export function toggleStarred(starredIds: readonly string[], sessionId: string): string[] {
  return starredIds.includes(sessionId)
    ? starredIds.filter((id) => id !== sessionId)
    : [...starredIds, sessionId];
}

/** Defensive parse of whatever localStorage hands back: a corrupt or
 * hand-edited value must never break the schedule page. */
export function parseStarredIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Speaker directory search
// ---------------------------------------------------------------------------

/**
 * Name-first speaker search. Title and company are matched too — an attendee
 * scanning for "everyone from Anthropic" expects that to work — but the
 * rubric-critical case is the name, including accented ones (see `foldText`).
 */
export function speakerMatchesQuery(
  speaker: Pick<GallerySpeaker, "name" | "title" | "company">,
  query: string,
): boolean {
  const terms = foldText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = foldText([speaker.name, speaker.title, speaker.company].filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

/** Narrows the gallery, preserving its surname ordering. */
export function filterSpeakers(speakers: GallerySpeaker[], query: string): GallerySpeaker[] {
  return speakers.filter((speaker) => speakerMatchesQuery(speaker, query));
}

// ---------------------------------------------------------------------------
// Public JSON feed (spec.md "embeddable on an external website";
// decisions.md D-040: the "apps or databases" consumer Sessionboard serves
// with JSON — XML is deliberately dropped, see D-040's trade-off table).
// ---------------------------------------------------------------------------

/** One session row in the public feed — resolved names, no internal ids. */
export interface ProgramFeedSession {
  title: string;
  description: string | null;
  day: string;
  startTime: string;
  endTime: string;
  roomName: string | null;
  trackName: string | null;
  speakerNames: string[];
}

/** One speaker row in the public feed. No email: the public gallery/schedule
 * this feed mirrors never falls back to a speaker's email address either
 * (see src/app/p/[eventSlug]/data.ts), so the feed can't leak one either. */
export interface ProgramFeedSpeaker {
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
}

export interface ProgramFeed {
  event: { name: string; timezone: string };
  sessions: ProgramFeedSession[];
  speakers: ProgramFeedSpeaker[];
}

/**
 * Shapes the public program into the public JSON feed. Takes the exact same
 * `ScheduleDay[]`/`GallerySpeaker[]` the HTML pages render from (built by
 * `buildSchedule`/`buildGallery`, both already filtered to confirmed —
 * and, for sessions, scheduled — data per `scheduleSessions`/`gallerySessions`
 * above), so the feed can never show anything the pages themselves wouldn't:
 * same visibility rules, same resolved names, no internal ids.
 */
export function buildProgramFeed(
  event: { name: string; timezone: string },
  days: ScheduleDay[],
  speakers: GallerySpeaker[],
): ProgramFeed {
  return {
    event: { name: event.name, timezone: event.timezone },
    sessions: flattenSchedule(days).map((session) => ({
      title: session.title,
      description: session.description,
      day: session.day,
      startTime: session.startTime,
      endTime: session.endTime,
      roomName: session.roomName,
      trackName: session.trackName,
      speakerNames: session.speakerNames,
    })),
    speakers: speakers.map((speaker) => ({
      name: speaker.name,
      title: speaker.title,
      company: speaker.company,
      bio: speaker.bio,
      headshotUrl: speaker.headshotUrl,
    })),
  };
}

/**
 * Resolves a possibly-relative asset URL (headshots uploaded through the CFP
 * flow are stored as `/files/<key>` — see src/app/files/[...key]/route.ts —
 * while seed/demo headshots are already absolute) against the request's
 * origin, so an external feed consumer always gets a URL it can fetch
 * without knowing where Greenroom is hosted.
 */
export function resolveFeedAssetUrl(origin: string, url: string | null): string | null {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

// ---------------------------------------------------------------------------
// Public iCal feed (spec.md "embeddable on an external website";
// decisions.md D-040): every approved, scheduled session as one downloadable
// calendar, built via src/lib/ics.ts's `buildItineraryCalendar` — see
// src/app/p/[eventSlug]/feed.ics/route.ts.
// ---------------------------------------------------------------------------

/** Maps the public schedule to the `ItineraryEntry[]` shape
 * `buildItineraryCalendar` (src/lib/ics.ts) expects — pulled out of the route
 * handler so the mapping is testable without a datastore. */
export function scheduleFeedEntries(days: ScheduleDay[]): ItineraryEntry[] {
  return flattenSchedule(days).map((session) => ({
    sessionId: session.id,
    title: session.title,
    description: session.description,
    location: session.roomName,
    day: session.day,
    startTime: session.startTime,
    endTime: session.endTime,
  }));
}
