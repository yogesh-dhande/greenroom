"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  dayStringSchema,
  sessionContentStatusSchema,
  timeStringSchema,
} from "@/db/entities";
import {
  AdminWorkflowError,
  createSession as createAdminSession,
  placeSession as placeAdminSession,
  setSessionSpeakers as setAdminSessionSpeakers,
  unscheduleSession as unscheduleAdminSession,
  updateSession as updateAdminSession,
} from "@/domain/admin-api";
import { durationMinutes, isValidSessionDuration, minutesOfDay } from "@/domain/scheduling";
import { planAbstractRestore } from "@/domain/session-content";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

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

function workflowFailure(error: unknown, fallback: string) {
  return fail(error instanceof AdminWorkflowError ? error.message : fallback);
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
  })
  // Defense-in-depth for the custom-duration entry in session-edit-dialog.tsx:
  // the client already blocks out-of-range values, but a placement can also
  // arrive from drag/resize on the board, so the bound is enforced here too.
  .refine((v) => isValidSessionDuration(durationMinutes(v.startTime, v.endTime)), {
    message: "Session length must be a whole number of minutes, between 5 and 480",
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
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Session not found");

  try {
    await placeAdminSession({ repos }, event.id, sessionId, parsed.data);
    revalidatePath(agendaPath(eventSlug));
    return { ok: true as const };
  } catch (error) {
    return workflowFailure(error, "Couldn't save the placement — try again");
  }
}

/** Returns a session to the unscheduled tray, keeping everything else —
 * including its start/end times. A session's length is only recorded as that
 * span (`sessionFormatLabel` derives the format from it), so nulling the
 * times would turn a 15-minute lightning talk back into the default length
 * on its next placement. "Placed" everywhere means day+times together
 * (`isPlacedOnAgenda`), so a day-less session with times still sits in the
 * tray and can't conflict with anything. */
export async function unscheduleSession(eventSlug: string, sessionId: string) {
  await requireAdmin(agendaPath(eventSlug));

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Session not found");

  try {
    await unscheduleAdminSession({ repos }, event.id, sessionId);
    revalidatePath(agendaPath(eventSlug));
    return { ok: true as const };
  } catch (error) {
    return workflowFailure(error, "Couldn't unschedule the session — try again");
  }
}

// ---------------------------------------------------------------------------
// Content edits (decisions.md D-054(5)) — an organizer fixing a typo'd title,
// tightening an abstract, or correcting the track on an already-accepted
// session. The session row is the single source of truth the public program
// reads, so this writes it directly rather than forking content onto the
// submission that produced it.
//
// This is also where editorial approval is set (D-072) and where an abstract
// edit lands in the revision history (D-071) — it is the only path in the app
// that changes an existing session's abstract.
// ---------------------------------------------------------------------------

const sessionContentSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  trackId: z.string().min(1).nullable().optional(),
  /** Optional so a caller that predates D-072 leaves approval untouched. */
  contentStatus: sessionContentStatusSchema.optional(),
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
  const admin = await requireAdmin(agendaPath(eventSlug));

  const parsed = sessionContentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid session details");

  const repos = await getRepos();
  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(sessionId),
  ]);
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");

  const nextDescription = parsed.data.description || null;

  try {
    await updateAdminSession({ repos }, event.id, sessionId, admin.id, {
      title: parsed.data.title,
      description: nextDescription,
      trackId: parsed.data.trackId ?? null,
      ...(parsed.data.contentStatus ? { contentStatus: parsed.data.contentStatus } : {}),
    });
    revalidatePath(agendaPath(eventSlug));
    // Every public program surface reads this same session row. Content
    // status can add/remove it entirely, while title, abstract, track and
    // speakers can change what the remaining surfaces render.
    revalidatePath(`/p/${eventSlug}`);
    revalidatePath(`/p/${eventSlug}/schedule`);
    revalidatePath(`/p/${eventSlug}/speakers`);
    revalidatePath(`/p/${eventSlug}/feed.json`);
    revalidatePath(`/p/${eventSlug}/feed.xml`);
    revalidatePath(`/p/${eventSlug}/feed.ics`);
    revalidatePath(`/embed/${eventSlug}/schedule`);
    revalidatePath(`/embed/${eventSlug}/speakers`);
    if (session.submissionId) {
      revalidatePath(`/admin/${eventSlug}/submissions`);
      revalidatePath(`/admin/${eventSlug}/submissions/${session.submissionId}`);
    }
    return { ok: true as const };
  } catch (error) {
    return workflowFailure(error, "Couldn't save those details — try again");
  }
}

/**
 * Puts an earlier abstract back (decisions.md D-071). The value comes from the
 * chosen history entry's `priorValue` and is written through
 * `updateSessionContent` above — the same path an organizer's own edit takes —
 * so the restore appends its own revision row instead of rewinding anything.
 * Nothing is ever deleted from the history: the abstract being replaced
 * becomes the new entry's prior value, so the restore is itself undoable.
 */
export async function restoreAbstractRevision(eventSlug: string, revisionId: string) {
  await requireAdmin(agendaPath(eventSlug));

  const repos = await getRepos();
  const revision = await repos.sessionRevisions.getById(revisionId);
  if (!revision) return fail("That revision no longer exists");

  const [event, session] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.sessions.getById(revision.sessionId),
  ]);
  // The revision id arrives from the client, so the event scope is checked
  // here and not assumed: a revision from another event's session is a miss.
  if (!event || !session || session.eventId !== event.id) return fail("Session not found");

  const plan = planAbstractRestore(session.description, revision.priorValue);
  if (!plan) return fail("That version is already the current abstract");

  return updateSessionContent(eventSlug, session.id, {
    title: session.title,
    // The rest of the session's content rides along unchanged — this action
    // only ever moves the abstract.
    description: plan.value ?? undefined,
    trackId: session.trackId,
    contentStatus: session.contentStatus,
  });
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
 * The shared workflow verifies every id against the same three membership
 * sources as the Speakers page; the dialog only offers roster members, and
 * this is defense against a stale or tampered request.
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

  try {
    await setAdminSessionSpeakers({ repos }, event.id, sessionId, parsed.data.speakerIds);
    revalidatePath(agendaPath(eventSlug));
    revalidatePath(`/p/${eventSlug}/schedule`);
    revalidatePath(`/embed/${eventSlug}/schedule`);
    revalidatePath(`/admin/${eventSlug}/speakers`);
    if (session.submissionId) {
      revalidatePath(`/admin/${eventSlug}/submissions`);
      revalidatePath(`/admin/${eventSlug}/submissions/${session.submissionId}`);
    }
    return { ok: true as const };
  } catch (error) {
    if (error instanceof AdminWorkflowError && error.code === "not_found") {
      return fail(
        error.message === "Session not found"
          ? error.message
          : "One of those speakers isn't on this event's roster",
      );
    }
    return workflowFailure(error, "Couldn't update the speaker list — try again");
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

  try {
    const { session } = await createAdminSession({ repos }, event.id, {
      title: v.title,
      description: v.description,
      trackId: v.trackId,
      speakerIds: v.existingSpeakerIds,
      newSpeakers: v.newSpeakers,
    });

    revalidatePath(agendaPath(eventSlug));
    revalidatePath(`/admin/${eventSlug}/speakers`);
    return { ok: true as const, data: { sessionId: session.id } };
  } catch (error) {
    return workflowFailure(error, "Couldn't create the session — try again");
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
