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
}

export interface GallerySpeaker extends ProgramPerson {
  talks: GalleryTalk[];
}

/**
 * One card per speaker, even when they co-present or have multiple accepted
 * talks — each talk title is collected onto that one card rather than
 * printing the same person twice. Speakers with no entry in `people` (e.g. a
 * stale link) are skipped rather than rendered with blanks. Sorted by name
 * for a stable, scannable gallery.
 */
export function buildGallery(
  sessions: SessionWithSpeakers[],
  people: Map<string, ProgramPerson>,
): GallerySpeaker[] {
  const bySpeaker = new Map<string, GallerySpeaker>();

  for (const session of gallerySessions(sessions)) {
    for (const speakerId of session.speakerIds) {
      const person = people.get(speakerId);
      if (!person) continue;

      const talk: GalleryTalk = { sessionId: session.id, title: session.title };
      const existing = bySpeaker.get(speakerId);
      if (existing) {
        existing.talks.push(talk);
      } else {
        bySpeaker.set(speakerId, { ...person, talks: [talk] });
      }
    }
  }

  return [...bySpeaker.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Schedule: sessions -> days -> time slots
// ---------------------------------------------------------------------------

export interface ScheduleSessionView {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  trackName: string | null;
  trackColor: string | null;
  roomName: string | null;
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
      startTime: session.startTime,
      endTime: session.endTime,
      trackName: track?.name ?? null,
      trackColor: track?.color ?? null,
      roomName: room?.name ?? null,
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
