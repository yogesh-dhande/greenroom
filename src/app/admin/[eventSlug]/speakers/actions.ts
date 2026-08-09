"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Event, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { normalizeEmail } from "@/domain/team";
import {
  importProfilePatch,
  parseSpeakerCsv,
  summarizeImport,
  type SpeakerImportProblem,
  type SpeakerImportResultRow,
  type SpeakerImportRow,
  type SpeakerImportSummary,
} from "@/domain/speaker-import";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";

function fail(error: string) {
  return { ok: false as const, error };
}

function rosterPath(eventSlug: string) {
  return `/admin/${eventSlug}/speakers`;
}

/** Shared field limits: the dialog, the CSV import and the record page's
 * profile editor all accept exactly the same values. */
const profileFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "Keep the name under 120 characters"),
  title: z.string().trim().max(120, "Keep the title under 120 characters").optional(),
  company: z.string().trim().max(120, "Keep the company under 120 characters").optional(),
  bio: z.string().trim().max(2000, "Keep the bio under 2000 characters").optional(),
});

const addSpeakerInputSchema = profileFieldsSchema.extend({
  email: z.email("Enter a valid email address"),
});
export type AddSpeakerInput = z.infer<typeof addSpeakerInputSchema>;

/**
 * Creates or reuses the person behind an address, and gives them a place on
 * this event's roster (decisions.md D-051).
 *
 * The roster is derived from three membership sources — sessions, task
 * assignments, and the `event_speakers` record this writes — so a hand-added
 * speaker gets a real membership row rather than a special case in the page
 * query. Reuse is by address, case-insensitively, which is what stops a
 * second "Add speaker" (or a re-run import) from forking someone's record.
 *
 * An existing account keeps its role: an admin or reviewer who also speaks is
 * a normal arrangement, and demoting them to `speaker` here would revoke
 * their access as a side effect of a roster edit (decisions.md D-044(1)).
 */
async function createOrReuseSpeaker(
  repos: Repos,
  event: Event,
  row: Pick<SpeakerImportRow, "name" | "email" | "title" | "company" | "bio">,
): Promise<{ user: User; created: boolean; filled: string[] }> {
  const email = normalizeEmail(row.email);
  const existing = await repos.users.getByEmail(email);

  if (existing) {
    const patch = importProfilePatch(existing, row);
    const filled = Object.keys(patch);
    const user = filled.length > 0 ? await repos.users.update(existing.id, patch) : existing;
    await repos.eventSpeakers.add(event.id, user.id);
    return { user, created: false, filled };
  }

  // No account yet: the row the magic link will land on, exactly as the team
  // invite writes it (decisions.md D-044(3)) — better-auth adopts a
  // pre-created row on first sign-in instead of making a second one.
  const user = await repos.users.create({
    email,
    emailVerified: false,
    name: row.name,
    role: "speaker",
    title: row.title,
    company: row.company,
    bio: row.bio,
    headshotUrl: null,
    // The speaker fills these in themselves at /portal/profile (spec.md §6).
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
  });
  await repos.eventSpeakers.add(event.id, user.id);
  return { user, created: true, filled: [] };
}

/**
 * The roster's manual "Add speaker" (spec.md §5): a speaker who never went
 * through the CFP — an invited keynote, a sponsor's presenter — entered by
 * hand, with no submission to accept first.
 */
export async function addSpeaker(eventSlug: string, input: AddSpeakerInput) {
  const { event } = await requireEventAdmin(eventSlug);

  const parsed = addSpeakerInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check those details");

  const repos = await getRepos();
  const email = normalizeEmail(parsed.data.email);

  let result: { user: User; created: boolean };
  try {
    result = await createOrReuseSpeaker(repos, event, {
      name: parsed.data.name,
      email,
      title: parsed.data.title || null,
      company: parsed.data.company || null,
      bio: parsed.data.bio || null,
    });
  } catch {
    return fail("Couldn't add that speaker — try again");
  }

  revalidatePath(rosterPath(eventSlug));
  return {
    ok: true as const,
    data: {
      speakerId: result.user.id,
      message: result.created
        ? `${parsed.data.name} was added to the roster`
        : `${email} already had an account — they're on the roster now`,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV import (decisions.md D-051)
// ---------------------------------------------------------------------------

export interface ImportSpeakersResult {
  summary: SpeakerImportSummary;
  /** Lines the parser refused, with why — shown beside the per-row results. */
  problems: SpeakerImportProblem[];
}

/**
 * Bulk version of `addSpeaker`, over the same creation path — so an import
 * and a manual add produce identical records, and re-importing a file that
 * has already been imported merges rather than duplicates.
 *
 * Parsing is pure (src/domain/speaker-import.ts); this only writes and
 * reports. Rows are written one at a time on purpose: one failing row must
 * not cost the organizer the other forty-nine, and D1 has no cross-statement
 * transaction we'd gain anything from here.
 */
export async function importSpeakers(eventSlug: string, csv: string) {
  const { event } = await requireEventAdmin(eventSlug);

  if (typeof csv !== "string" || csv.trim() === "") return fail("Paste some CSV first");
  if (csv.length > 500_000) return fail("That file is too big to import in one go");

  const { rows, problems } = parseSpeakerCsv(csv);
  const repos = await getRepos();
  const results: SpeakerImportResultRow[] = [];

  for (const row of rows) {
    try {
      const { user, created, filled } = await createOrReuseSpeaker(repos, event, row);
      results.push({
        email: user.email,
        name: user.name ?? row.name,
        outcome: created ? "created" : "merged",
        detail: created
          ? undefined
          : filled.length > 0
            ? `Already had an account — filled in ${filled.join(", ")}`
            : "Already had an account — nothing to change",
      });
    } catch {
      results.push({
        email: row.email,
        name: row.name,
        outcome: "skipped",
        detail: "Couldn't be saved — try that row again",
      });
    }
  }

  revalidatePath(rosterPath(eventSlug));
  return {
    ok: true as const,
    data: { summary: summarizeImport(results), problems } satisfies ImportSpeakersResult,
  };
}

// ---------------------------------------------------------------------------
// Record page edits (decisions.md D-051)
// ---------------------------------------------------------------------------

const updateProfileInputSchema = profileFieldsSchema.extend({
  speakerId: z.string().min(1),
});
export type UpdateSpeakerProfileInput = z.infer<typeof updateProfileInputSchema>;

/**
 * Loads a speaker and checks they're on *this* event's roster before any
 * write — a speaker id is a user id, so without this an admin could edit
 * anyone on the instance from an event they happen to administer.
 */
async function loadRosterSpeaker(repos: Repos, event: Event, speakerId: string) {
  const [member, assignments, sessions] = await Promise.all([
    repos.eventSpeakers.get(event.id, speakerId),
    repos.taskAssignments.listByEvent(event.id),
    repos.sessions.listBySpeaker(speakerId),
  ]);
  const onRoster =
    Boolean(member) ||
    assignments.some((assignment) => assignment.speakerId === speakerId) ||
    sessions.some((session) => session.eventId === event.id);
  if (!onRoster) return null;
  return repos.users.getById(speakerId);
}

/**
 * Organizer edits to a speaker's profile (D-051). Deliberately narrower than
 * the speaker's own profile page: name/title/company/bio only — headshot and
 * links stay theirs to set, and the roster already says who's missing one.
 */
export async function updateSpeakerProfile(eventSlug: string, input: UpdateSpeakerProfileInput) {
  const { event } = await requireEventAdmin(eventSlug);

  const parsed = updateProfileInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check those details");

  const repos = await getRepos();
  const speaker = await loadRosterSpeaker(repos, event, parsed.data.speakerId);
  if (!speaker) return fail("That speaker isn't on this event's roster");

  try {
    await repos.users.update(speaker.id, {
      name: parsed.data.name,
      title: parsed.data.title || null,
      company: parsed.data.company || null,
      bio: parsed.data.bio || null,
    });
  } catch {
    return fail("Couldn't save those details — try again");
  }

  revalidatePath(rosterPath(eventSlug));
  revalidatePath(`${rosterPath(eventSlug)}/${speaker.id}`);
  return { ok: true as const, data: { message: "Profile updated" } };
}

const notesInputSchema = z.object({
  speakerId: z.string().min(1),
  notes: z.string().max(4000, "Keep notes under 4000 characters"),
});
export type SpeakerNotesInput = z.infer<typeof notesInputSchema>;

/**
 * The organizer-only logistics field (D-051) — "arrival May 11, aisle seat;
 * dietary: vegetarian". Per event, not per person: the same speaker at next
 * year's event starts with a blank sheet.
 */
export async function saveSpeakerNotes(eventSlug: string, input: SpeakerNotesInput) {
  const { event } = await requireEventAdmin(eventSlug);

  const parsed = notesInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Couldn't save those notes");

  const repos = await getRepos();
  const speaker = await loadRosterSpeaker(repos, event, parsed.data.speakerId);
  if (!speaker) return fail("That speaker isn't on this event's roster");

  const notes = parsed.data.notes.trim();
  try {
    await repos.eventSpeakers.setNotes(event.id, speaker.id, notes || null);
  } catch {
    return fail("Couldn't save those notes — try again");
  }

  revalidatePath(`${rosterPath(eventSlug)}/${speaker.id}`);
  return { ok: true as const, data: { message: notes ? "Notes saved" : "Notes cleared" } };
}
