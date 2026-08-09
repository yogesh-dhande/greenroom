"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { newRoomSchema, newTrackSchema, newEventSchema } from "@/db/entities";
import { runAirtableSync } from "@/domain/airtable-sync";
import { getAirtableSyncContext } from "@/lib/airtable-context";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { RESERVED_EVENT_SLUGS, SLUG_PATTERN } from "@/lib/slug";

function fail(error: string) {
  return { ok: false as const, error };
}

// ---------------------------------------------------------------------------
// Event identity/dates
// ---------------------------------------------------------------------------

const updateEventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug is required")
    .regex(SLUG_PATTERN, "Lowercase letters, numbers, and hyphens only")
    .refine((slug) => !(RESERVED_EVENT_SLUGS as readonly string[]).includes(slug), {
      message: "That slug is reserved — try another",
    }),
  description: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  timezone: z.string().trim().min(1, "Timezone is required"),
  location: z.string().trim().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

export async function updateEvent(eventId: string, currentSlug: string, input: UpdateEventInput) {
  await requireAdmin(`/admin/${currentSlug}/settings`);

  const parsed = updateEventInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid event details");
  const v = parsed.data;

  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    return fail("End date can't be before the start date");
  }

  const repos = await getRepos();

  if (v.slug !== currentSlug) {
    const existing = await repos.events.getBySlug(v.slug);
    if (existing) return fail("That slug is already in use by another event");
  }

  const patch = newEventSchema.partial().safeParse({
    name: v.name,
    slug: v.slug,
    description: v.description || null,
    startDate: v.startDate || null,
    endDate: v.endDate || null,
    timezone: v.timezone,
    location: v.location || null,
  });
  if (!patch.success) return fail(patch.error.issues[0]?.message ?? "Invalid event details");

  try {
    const event = await repos.events.update(eventId, patch.data);
    revalidatePath("/admin");
    revalidatePath(`/admin/${currentSlug}`, "layout");
    if (event.slug !== currentSlug) revalidatePath(`/admin/${event.slug}`, "layout");
    return { ok: true as const, data: { slug: event.slug } };
  } catch {
    return fail("Couldn't save the event — try again");
  }
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

const trackInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  color: z.string().trim().optional(),
});
export type TrackInput = z.infer<typeof trackInputSchema>;

export async function createTrack(eventSlug: string, eventId: string, input: TrackInput) {
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const parsed = trackInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid track");

  const candidate = newTrackSchema.safeParse({
    eventId,
    name: parsed.data.name,
    color: parsed.data.color || null,
  });
  if (!candidate.success) return fail(candidate.error.issues[0]?.message ?? "Invalid track");

  const repos = await getRepos();
  try {
    await repos.tracks.create(candidate.data);
    revalidatePath(`/admin/${eventSlug}/settings`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't create the track — try again");
  }
}

export async function updateTrack(eventSlug: string, trackId: string, input: TrackInput) {
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const parsed = trackInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid track");

  const repos = await getRepos();
  try {
    await repos.tracks.update(trackId, {
      name: parsed.data.name,
      color: parsed.data.color || null,
    });
    revalidatePath(`/admin/${eventSlug}/settings`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't save the track — try again");
  }
}

export async function deleteTrack(eventSlug: string, trackId: string) {
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const repos = await getRepos();

  // Block rather than silently orphan/detach: a track disappearing out from
  // under submissions that were routed to it, or sessions programmed under
  // it, would be confusing for a non-technical organizer to debug later.
  const [submissions, sessions] = await Promise.all([
    repos.submissions.listByTracks([trackId]),
    repos.sessions.listByTrack(trackId),
  ]);
  if (submissions.length > 0 || sessions.length > 0) {
    const parts: string[] = [];
    if (submissions.length > 0) {
      parts.push(`${submissions.length} submission${submissions.length === 1 ? "" : "s"}`);
    }
    if (sessions.length > 0) {
      parts.push(`${sessions.length} session${sessions.length === 1 ? "" : "s"}`);
    }
    return fail(
      `This track is still used by ${parts.join(" and ")}. Reassign or remove those first.`,
    );
  }

  try {
    await repos.tracks.delete(trackId);
    revalidatePath(`/admin/${eventSlug}/settings`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't delete the track — try again");
  }
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const roomInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  capacity: z.string().trim().optional(),
});
export type RoomInput = z.infer<typeof roomInputSchema>;

function parseCapacity(raw: string | undefined): number | null | "invalid" {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return "invalid";
  return n;
}

export async function createRoom(eventSlug: string, eventId: string, input: RoomInput) {
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const parsed = roomInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid room");

  const capacity = parseCapacity(parsed.data.capacity);
  if (capacity === "invalid") return fail("Capacity must be a whole number");

  const candidate = newRoomSchema.safeParse({ eventId, name: parsed.data.name, capacity });
  if (!candidate.success) return fail(candidate.error.issues[0]?.message ?? "Invalid room");

  const repos = await getRepos();
  try {
    await repos.rooms.create(candidate.data);
    revalidatePath(`/admin/${eventSlug}/settings`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't create the room — try again");
  }
}

export async function updateRoom(eventSlug: string, roomId: string, input: RoomInput) {
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const parsed = roomInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid room");

  const capacity = parseCapacity(parsed.data.capacity);
  if (capacity === "invalid") return fail("Capacity must be a whole number");

  const repos = await getRepos();
  try {
    await repos.rooms.update(roomId, { name: parsed.data.name, capacity });
    revalidatePath(`/admin/${eventSlug}/settings`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't save the room — try again");
  }
}

export async function deleteRoom(eventSlug: string, roomId: string) {
  await requireAdmin(`/admin/${eventSlug}/settings`);
  const repos = await getRepos();

  const sessions = await repos.sessions.listByRoom(roomId);
  if (sessions.length > 0) {
    return fail(
      `This room is still used by ${sessions.length} session${sessions.length === 1 ? "" : "s"}. Reassign or remove ${sessions.length === 1 ? "it" : "them"} first.`,
    );
  }

  try {
    await repos.rooms.delete(roomId);
    revalidatePath(`/admin/${eventSlug}/settings`);
    return { ok: true } as const;
  } catch {
    return fail("Couldn't delete the room — try again");
  }
}

// ---------------------------------------------------------------------------
// Airtable sync
// ---------------------------------------------------------------------------

/**
 * Pushes this event's current state to the Airtable base on demand — the same
 * `runAirtableSync` the cron calls (decisions.md D-036), so the button can
 * never project something the schedule wouldn't.
 *
 * Safe to press repeatedly: every write is an upsert keyed on `greenroom_id`,
 * so a second run updates the same rows rather than duplicating them.
 * Organizer-only, like the rest of this screen — the sync exposes the whole
 * event's speaker data to an external base.
 */
export async function syncToAirtableNow(eventSlug: string) {
  await requireAdmin(`/admin/${eventSlug}/settings`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Event not found");

  let summary;
  try {
    // Scoped to this event: the cron projects every event, but an organizer
    // pressing a button on one event's screen means "publish *this*".
    const ctx = await getAirtableSyncContext({ repos, eventId: event.id });
    summary = await runAirtableSync(ctx);
  } catch {
    return fail("Couldn't run the Airtable sync — try again");
  }

  return {
    ok: true as const,
    data: {
      skipped: summary.skipped,
      /** Names the missing variable, e.g. "AIRTABLE_API_KEY not set". */
      skippedReason: summary.skippedReason,
      created: summary.created,
      updated: summary.updated,
      failed: summary.failed,
      tablesCreated: summary.tablesCreated,
      /** First error only: the toast has no room for a stack of them. */
      error: summary.errors[0] ?? null,
    },
  };
}
