import { cache } from "react";
import { notFound } from "next/navigation";
import type { Event, Form } from "@/db/entities";
import { formWindowState } from "@/domain/forms";
import {
  buildGallery,
  buildSchedule,
  type GallerySpeaker,
  type ScheduleDay,
  type SessionWithSpeakers,
} from "@/domain/program";
import { getRepos } from "@/lib/db";

/**
 * Shared data loaders for the public program (spec.md "Important / strongly
 * desired": public speaker gallery + schedule). Used by both the chrome'd
 * `/p/[eventSlug]/*` pages and the chrome-less `/embed/[eventSlug]/*` pages
 * so the two surfaces never drift apart. Wrapped in React's `cache()` so a
 * layout + page rendering the same event in one request only hits D1 once.
 *
 * No auth anywhere in this module — these are public, unauthenticated pages
 * (spec.md: "public attendee (view-only)").
 */

export const getPublicEvent = cache(async (eventSlug: string): Promise<Event> => {
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();
  return event;
});

/** Every session for the event, with its speaker ids attached — the shape
 * src/domain/program.ts's grouping functions consume. */
const getSessionsWithSpeakers = cache(async (eventId: string): Promise<SessionWithSpeakers[]> => {
  const repos = await getRepos();
  const sessions = await repos.sessions.listByEvent(eventId);
  const links = await repos.sessions.listSpeakersBySessionIds(sessions.map((s) => s.id));
  const speakerIdsBySession = new Map<string, string[]>();
  for (const link of links) {
    speakerIdsBySession.set(link.sessionId, [
      ...(speakerIdsBySession.get(link.sessionId) ?? []),
      link.userId,
    ]);
  }
  return sessions.map((session) => ({
    ...session,
    speakerIds: speakerIdsBySession.get(session.id) ?? [],
  }));
});

export const getGallery = cache(async (eventSlug: string): Promise<GallerySpeaker[]> => {
  const event = await getPublicEvent(eventSlug);
  const repos = await getRepos();
  const sessions = await getSessionsWithSpeakers(event.id);

  const speakerIds = [...new Set(sessions.flatMap((s) => s.speakerIds))];
  const speakers = await repos.users.listByIds(speakerIds);
  const people = new Map(
    speakers.map((speaker) => [
      speaker.id,
      {
        id: speaker.id,
        // Never fall back to the email address here — this is a public page.
        name: speaker.name ?? "Speaker",
        title: speaker.title,
        company: speaker.company,
        bio: speaker.bio,
        headshotUrl: speaker.headshotUrl,
      },
    ]),
  );

  return buildGallery(sessions, people);
});

export const getSchedule = cache(async (eventSlug: string): Promise<ScheduleDay[]> => {
  const event = await getPublicEvent(eventSlug);
  const repos = await getRepos();
  const [sessions, tracks, rooms] = await Promise.all([
    getSessionsWithSpeakers(event.id),
    repos.tracks.listByEvent(event.id),
    repos.rooms.listByEvent(event.id),
  ]);

  const speakerIds = [...new Set(sessions.flatMap((s) => s.speakerIds))];
  const speakers = await repos.users.listByIds(speakerIds);

  return buildSchedule(sessions, {
    trackById: new Map(tracks.map((t) => [t.id, { name: t.name, color: t.color }])),
    roomById: new Map(rooms.map((r) => [r.id, { name: r.name }])),
    // Same public-page rule as the gallery: a missing name never exposes an
    // email address.
    speakerNameById: new Map(speakers.map((s) => [s.id, s.name ?? "Speaker"])),
  });
});

/** Forms a visitor could actually submit to right now — the event landing
 * page's "open calls for speakers" links. */
export const getOpenForms = cache(async (eventSlug: string): Promise<Form[]> => {
  const event = await getPublicEvent(eventSlug);
  const repos = await getRepos();
  const published = await repos.forms.listPublishedByEvent(event.id);
  return published.filter((form) => formWindowState(form) === "open");
});
