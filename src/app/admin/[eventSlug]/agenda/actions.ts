"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  dayStringSchema,
  newSessionSchema,
  newUserSchema,
  timeStringSchema,
} from "@/db/entities";
import { minutesOfDay } from "@/domain/scheduling";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { loadSpeakerRoster } from "../speakers/roster";

/**
 * Agenda-builder writes (spec.md §9, §5). Every drag, resize, and inline edit
 * calls one of these immediately — the board has no save button, so a change
 * the organizer sees on screen is a change already in the database.
 *
 * All persistence goes through the storage-agnostic repository layer; nothing
 * here knows the datastore is D1.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

function agendaPath(eventSlug: string) {
  return `/admin/${eventSlug}/agenda`;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const placementSchema = z
  .object({
    day: dayStringSchema,
    startTime: timeStringSchema,
    endTime: timeStringSchema,
    /** Null = placed on the day but not yet in a room. */
    roomId: z.string().min(1).nullable(),
  })
  .refine((v) => minutesOfDay(v.endTime) > minutesOfDay(v.startTime), {
    message: "The end time has to be after the start time",
  });
export type PlacementInput = z.infer<typeof placementSchema>;

/**
 * Puts a session on the board (or moves one already there). Conflicts are
 * never a reason to refuse: organizers deliberately park sessions on top of
 * each other while they work, and the board flags the result instead.
 */
export async function placeSession(
  eventSlug: string,
  sessionId: string,
  input: PlacementInput,
) {
  await requireAdmin(agendaPath(eventSlug));

  const parsed = placementSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid placement");

  const repos = await getRepos();
  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(sessionId),
  ]);
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");

  if (parsed.data.roomId) {
    const room = await repos.rooms.getById(parsed.data.roomId);
    if (!room || room.eventId !== event.id) return fail("That room isn't part of this event");
  }

  try {
    await repos.sessions.update(sessionId, parsed.data);
    revalidatePath(agendaPath(eventSlug));
    return { ok: true as const };
  } catch {
    return fail("Couldn't save the placement — try again");
  }
}

/** Returns a session to the unscheduled tray, keeping everything else. */
export async function unscheduleSession(eventSlug: string, sessionId: string) {
  await requireAdmin(agendaPath(eventSlug));

  const repos = await getRepos();
  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(sessionId),
  ]);
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");

  try {
    await repos.sessions.update(sessionId, {
      day: null,
      startTime: null,
      endTime: null,
      roomId: null,
    });
    revalidatePath(agendaPath(eventSlug));
    return { ok: true as const };
  } catch {
    return fail("Couldn't unschedule the session — try again");
  }
}

// ---------------------------------------------------------------------------
// Content edits (decisions.md D-054(5)) — an organizer fixing a typo'd title,
// tightening an abstract, or correcting the track on an already-accepted
// session. The session row is the single source of truth the public program
// reads, so this writes it directly rather than forking content onto the
// submission that produced it.
// ---------------------------------------------------------------------------

const sessionContentSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  trackId: z.string().min(1).nullable().optional(),
});
export type SessionContentInput = z.infer<typeof sessionContentSchema>;

/**
 * Saves an organizer's edits to a session's own content. Available for any
 * session — accepted, direct-entry, scheduled or still in the tray — since
 * the same typo can land in any of those paths.
 */
export async function updateSessionContent(
  eventSlug: string,
  sessionId: string,
  input: SessionContentInput,
) {
  await requireAdmin(agendaPath(eventSlug));

  const parsed = sessionContentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid session details");

  const repos = await getRepos();
  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(sessionId),
  ]);
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");

  if (parsed.data.trackId) {
    const track = await repos.tracks.getById(parsed.data.trackId);
    if (!track || track.eventId !== event.id) return fail("That track isn't part of this event");
  }

  try {
    await repos.sessions.update(sessionId, {
      title: parsed.data.title,
      description: parsed.data.description || null,
      trackId: parsed.data.trackId ?? null,
    });
    revalidatePath(agendaPath(eventSlug));
    // The public program and its embed read this same session row.
    revalidatePath(`/p/${eventSlug}/schedule`);
    revalidatePath(`/embed/${eventSlug}/schedule`);
    if (session.submissionId) {
      revalidatePath(`/admin/${eventSlug}/submissions`);
      revalidatePath(`/admin/${eventSlug}/submissions/${session.submissionId}`);
    }
    return { ok: true as const };
  } catch {
    return fail("Couldn't save those details — try again");
  }
}

// ---------------------------------------------------------------------------
// Speaker list (decisions.md D-057) — a session converted from an accepted
// submission previously had no surface to add a late co-speaker or correct
// the list; this is the organizer-driven edit path (the CFP sync path,
// src/domain/submissions.ts syncSpeakers, already keeps a session's speakers
// in step with pre-acceptance edits).
// ---------------------------------------------------------------------------

const sessionSpeakersSchema = z.object({
  /** Zero is valid — some sessions are placeholders waiting on a name. */
  speakerIds: z.array(z.string().min(1)).default([]),
});
export type SessionSpeakersInput = z.infer<typeof sessionSpeakersSchema>;

/**
 * Replaces a session's speaker list wholesale — the client always sends the
 * full set it wants, not a single add/remove, so there's nothing to diff.
 * Every id must be on the event's roster (loadSpeakerRoster, same source the
 * Speakers page reads): the dialog only ever offers roster members, this is
 * defense against a stale or tampered request.
 */
export async function updateSessionSpeakers(
  eventSlug: string,
  sessionId: string,
  input: SessionSpeakersInput,
) {
  await requireAdmin(agendaPath(eventSlug));

  const parsed = sessionSpeakersSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid speaker list");

  const repos = await getRepos();
  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(sessionId),
  ]);
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");

  const speakerIds = [...new Set(parsed.data.speakerIds)];
  if (speakerIds.length > 0) {
    const roster = await loadSpeakerRoster(repos, event.id);
    const rosterIds = new Set(roster.rollups.map((rollup) => rollup.speaker.id));
    if (speakerIds.some((id) => !rosterIds.has(id))) {
      return fail("One of those speakers isn't on this event's roster");
    }
  }

  try {
    await repos.sessions.setSpeakers(sessionId, speakerIds);
    revalidatePath(agendaPath(eventSlug));
    revalidatePath(`/p/${eventSlug}/schedule`);
    revalidatePath(`/embed/${eventSlug}/schedule`);
    revalidatePath(`/admin/${eventSlug}/speakers`);
    if (session.submissionId) {
      revalidatePath(`/admin/${eventSlug}/submissions`);
      revalidatePath(`/admin/${eventSlug}/submissions/${session.submissionId}`);
    }
    return { ok: true as const };
  } catch {
    return fail("Couldn't update the speaker list — try again");
  }
}

// ---------------------------------------------------------------------------
// Direct session entry (spec.md §5 — sponsor talks and other guaranteed
// speakers that never went through the CFP)
// ---------------------------------------------------------------------------

const newSpeakerSchema = z.object({
  name: z.string().trim().min(1, "Speaker name is required"),
  email: z.email("Enter a valid email address").transform((e) => e.trim().toLowerCase()),
});

const directSessionSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  trackId: z.string().min(1).nullable().optional(),
  /** Speakers already in Greenroom, picked from the directory. */
  existingSpeakerIds: z.array(z.string().min(1)).default([]),
  /** People typed in by name + email; created as speaker users on save. */
  newSpeakers: z.array(newSpeakerSchema).default([]),
});
export type DirectSessionInput = z.input<typeof directSessionSchema>;

export async function createDirectSession(eventSlug: string, input: DirectSessionInput) {
  await requireAdmin(agendaPath(eventSlug));

  const parsed = directSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid session");
  const v = parsed.data;

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Event not found");

  if (v.trackId) {
    const track = await repos.tracks.getById(v.trackId);
    if (!track || track.eventId !== event.id) return fail("That track isn't part of this event");
  }

  const candidate = newSessionSchema.safeParse({
    eventId: event.id,
    title: v.title,
    description: v.description || null,
    // No submission: this is the "guaranteed speaker" path (spec.md §5).
    submissionId: null,
    trackId: v.trackId ?? null,
    roomId: null,
    day: null,
    startTime: null,
    endTime: null,
    status: "confirmed",
  });
  if (!candidate.success) return fail(candidate.error.issues[0]?.message ?? "Invalid session");

  try {
    // Resolve people first: a typed-in speaker who already exists (same email)
    // is reused rather than duplicated.
    const speakerIds = new Set(v.existingSpeakerIds);
    for (const person of v.newSpeakers) {
      const existing = await repos.users.getByEmail(person.email);
      if (existing) {
        speakerIds.add(existing.id);
        continue;
      }
      const newUser = newUserSchema.safeParse({
        email: person.email,
        emailVerified: false,
        name: person.name,
        role: "speaker",
        title: null,
        company: null,
        bio: null,
        headshotUrl: null,
        // Filled in by the speaker themselves at /portal/profile (spec.md §6).
        websiteUrl: null,
        linkedinUrl: null,
        twitterUrl: null,
        socials: null,
        image: null,
      });
      if (!newUser.success) return fail(`Couldn't add ${person.email} — check the address`);
      const created = await repos.users.create(newUser.data);
      speakerIds.add(created.id);
    }

    const session = await repos.sessions.create(candidate.data);
    if (speakerIds.size > 0) {
      await repos.sessions.setSpeakers(session.id, [...speakerIds]);
    }

    revalidatePath(agendaPath(eventSlug));
    revalidatePath(`/admin/${eventSlug}/speakers`);
    return { ok: true as const, data: { sessionId: session.id } };
  } catch {
    return fail("Couldn't create the session — try again");
  }
}

/** Removes a session entirely — the undo for a mistyped direct entry. */
export async function deleteSession(eventSlug: string, sessionId: string) {
  await requireAdmin(agendaPath(eventSlug));

  const repos = await getRepos();
  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(sessionId),
  ]);
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");
  if (session.submissionId) {
    return fail(
      "This session came from an accepted submission — unschedule it instead of deleting it.",
    );
  }

  try {
    await repos.sessions.delete(sessionId);
    revalidatePath(agendaPath(eventSlug));
    return { ok: true as const };
  } catch {
    return fail("Couldn't delete the session — try again");
  }
}
