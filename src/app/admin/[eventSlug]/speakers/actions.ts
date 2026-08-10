"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { speakerConfirmationSchema, type Event, type User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { sendPortalInvite, sendTaskAssignmentNotification } from "@/domain/comms";
import { normalizeEmail } from "@/domain/team";
import { planAssignToSpeakers } from "@/domain/task-assign";
import {
  importProfilePatch,
  parseSpeakerCsv,
  summarizeImport,
  type SpeakerImportProblem,
  type SpeakerImportResultRow,
  type SpeakerImportRow,
  type SpeakerImportSummary,
} from "@/domain/speaker-import";
import { getCommsContext } from "@/lib/comms-context";
import { getFilesBucket, getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import {
  checkUpload,
  filenameFromKey,
  fileUrl,
  isImageUploadType,
  isServableKey,
  uploadKey,
  uploadProblemMessage,
} from "@/lib/uploads";

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

/** Same object-key namespace the speaker's own upload uses (spec.md §6,
 * src/app/portal/profile/actions.ts) — an organizer's upload and a speaker's
 * later one both live under `uploads/profile/`, so there's no second scheme
 * to keep in sync. */
const HEADSHOT_SCOPE = "profile";

/**
 * Organizer-supplied headshot (decisions.md D-054(5)): the roster flags "No
 * headshot" for a speaker who hasn't reached /portal/profile yet, and an
 * organizer with a photo already in hand — a badge scan, a press kit —
 * shouldn't have to wait on them. Drives the exact same R2 upload machinery
 * as the portal's `uploadHeadshot` (src/lib/uploads.ts: the size/type checks,
 * the key scheme, `isServableKey`), just combined into one step since this
 * action has nothing else on the form to save — it writes `headshotUrl`
 * itself rather than handing a key back to a second action.
 */
export async function uploadSpeakerHeadshot(
  eventSlug: string,
  speakerId: string,
  formData: FormData,
) {
  const { event, user: admin } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const speaker = await loadRosterSpeaker(repos, event, speakerId);
  if (!speaker) return fail("That speaker isn't on this event's roster");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file was received.");

  const problem = checkUpload(file);
  if (problem) return fail(uploadProblemMessage(problem));
  if (!isImageUploadType(file.type)) {
    return fail("A headshot has to be an image — JPEG, PNG, WebP, GIF, or AVIF.");
  }

  const key = uploadKey(HEADSHOT_SCOPE, file.name);
  if (!isServableKey(key)) return fail("That filename can't be stored.");

  try {
    const bucket = await getFilesBucket();
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: {
        contentType: file.type,
        contentDisposition: `inline; filename="${file.name.replace(/"/g, "")}"`,
      },
    });
    await repos.users.update(speaker.id, { headshotUrl: fileUrl(key) });
    // Tracked as a file as well as an avatar (spec.md §6): the Files library
    // and the speaker's Uploads panel both report headshots, and this row is
    // the filename/uploader/timestamp behind them. `uploadedBy` is the
    // organizer here — the owner is the speaker they supplied it for.
    await repos.fileVersions.create({
      scope: "profile",
      ownerUserId: speaker.id,
      fileKey: key,
      url: fileUrl(key),
      filename: filenameFromKey(key),
      uploadedBy: admin.id,
    });
  } catch {
    return fail("Couldn't save that headshot — try again");
  }

  revalidatePath(rosterPath(eventSlug));
  revalidatePath(`${rosterPath(eventSlug)}/${speaker.id}`);
  revalidatePath(`/admin/${eventSlug}/files`);
  // Headshots feed the public gallery and schedule bylines too (spec.md §6).
  revalidatePath(`/p/${eventSlug}/speakers`);
  revalidatePath(`/p/${eventSlug}/schedule`);
  revalidatePath(`/embed/${eventSlug}/speakers`);
  revalidatePath(`/embed/${eventSlug}/schedule`);
  return { ok: true as const };
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

// ---------------------------------------------------------------------------
// Confirmation status (decisions.md D-068)
// ---------------------------------------------------------------------------

const confirmationInputSchema = z.object({
  speakerId: z.string().min(1),
  /** `null` is a real, meaningful value here — "back to automatic" — so it is
   * spelled out rather than left to an omitted field. */
  confirmation: speakerConfirmationSchema.nullable(),
});
export type SpeakerConfirmationInput = z.infer<typeof confirmationInputSchema>;

/**
 * Sets or clears the organizer's stored confirmation for one speaker
 * (decisions.md D-068).
 *
 * Three states, not two: `confirmed` and `declined` are stored and win over
 * the session-attachment derivation everywhere confirmation is shown or
 * filtered, and `null` clears the override so the speaker goes back to
 * deriving — which is where every row starts and where un-answered rows stay
 * (no backfill). Clearing is therefore a write of null, never a no-op.
 *
 * Writing through `eventSpeakers.setConfirmation` creates the membership row
 * when it doesn't exist yet: a speaker who arrived through acceptance has a
 * session but no `event_speakers` record, and they're exactly who an
 * organizer marks `declined` first.
 */
export async function setSpeakerConfirmation(
  eventSlug: string,
  input: SpeakerConfirmationInput,
) {
  const { event } = await requireEventAdmin(eventSlug);

  const parsed = confirmationInputSchema.safeParse(input);
  if (!parsed.success) return fail("That isn't a confirmation status");

  const repos = await getRepos();
  const speaker = await loadRosterSpeaker(repos, event, parsed.data.speakerId);
  if (!speaker) return fail("That speaker isn't on this event's roster");

  try {
    await repos.eventSpeakers.setConfirmation(event.id, speaker.id, parsed.data.confirmation);
  } catch {
    return fail("Couldn't save that status — try again");
  }

  revalidatePath(rosterPath(eventSlug));
  revalidatePath(`${rosterPath(eventSlug)}/${speaker.id}`);
  // "Assign to confirmed speakers" reads the same roster (decisions.md D-069),
  // so a declined speaker has to drop out of that picker too.
  revalidatePath(`/admin/${eventSlug}/tasks`);
  return {
    ok: true as const,
    data: {
      message:
        parsed.data.confirmation === null
          ? "Confirmation back to automatic"
          : parsed.data.confirmation === "confirmed"
            ? "Marked confirmed"
            : "Marked declined",
    },
  };
}

// ---------------------------------------------------------------------------
// Assign one task to this speaker (decisions.md D-052, D-069)
// ---------------------------------------------------------------------------

const assignTaskInputSchema = z.object({
  speakerId: z.string().min(1),
  taskId: z.string().min(1, "Pick a task to assign"),
});
export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;

/**
 * Hands one of this event's tasks to one speaker, from their record page
 * (decisions.md D-052, shipped by D-069).
 *
 * Both event-scoping guards apply, because a task id and a speaker id are
 * both just ids on a public endpoint: the speaker must be on *this* event's
 * roster (`loadRosterSpeaker`) and the task must belong to *this* event.
 *
 * Idempotent by the same machinery as every other assignment path: the
 * existing row is read with `getByTaskAndSpeaker` and handed to
 * `planAssignToSpeakers`, which plans nothing for a speaker who already
 * holds the task. Re-assigning is therefore a no-op — no duplicate row (the
 * `unique(taskId, speakerId)` constraint would refuse one anyway), and no
 * touch to a status/completedAt that's already been earned. The assignment
 * notification (D-039) inherits that: it goes out only when a row was
 * actually created, so a re-assign is silent as well as harmless.
 */
export async function assignTaskToSpeaker(eventSlug: string, input: AssignTaskInput) {
  const { event, user: admin } = await requireEventAdmin(eventSlug);

  const parsed = assignTaskInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Pick a task to assign");

  const repos = await getRepos();
  const speaker = await loadRosterSpeaker(repos, event, parsed.data.speakerId);
  if (!speaker) return fail("That speaker isn't on this event's roster");

  const task = await repos.tasks.getById(parsed.data.taskId);
  if (!task || task.eventId !== event.id) return fail("That task no longer exists");

  let assigned: boolean;
  const createdIds: string[] = [];
  try {
    const existing = await repos.taskAssignments.getByTaskAndSpeaker(task.id, speaker.id);
    const plan = planAssignToSpeakers({
      taskId: task.id,
      speakerIds: [speaker.id],
      existingAssignments: existing ? [existing] : [],
    });
    for (const assignment of plan.newAssignments) {
      createdIds.push((await repos.taskAssignments.create(assignment)).id);
    }
    assigned = plan.newAssignments.length > 0;
  } catch {
    return fail("Couldn't assign that task — try again");
  }

  if (createdIds.length > 0) {
    // The one-time assignment notification (decisions.md D-039). Logged and
    // swallowed rather than returned: the task is on their portal either way,
    // and reporting a failed assignment because the mail bounced would be the
    // bigger lie (same handling as
    // src/app/portal/submissions/[id]/actions.ts). `organizerName` is the
    // acting admin, per D-053(2).
    try {
      const comms = await getCommsContext({
        repos,
        organizerName: admin.name?.trim() || admin.email,
        organizerEmail: admin.email,
      });
      await sendTaskAssignmentNotification(comms, { assignmentIds: createdIds });
    } catch (error) {
      console.error("task assignment notification failed", error);
    }
  }

  revalidatePath(`${rosterPath(eventSlug)}/${speaker.id}`);
  revalidatePath(rosterPath(eventSlug));
  revalidatePath(`/admin/${eventSlug}/tasks`);
  revalidatePath("/portal");
  return {
    ok: true as const,
    data: {
      assigned,
      message: assigned
        ? `"${task.title}" assigned to ${speaker.name ?? speaker.email}`
        : `${speaker.name ?? speaker.email} already has "${task.title}"`,
    },
  };
}

// ---------------------------------------------------------------------------
// Portal invitation (decisions.md D-070)
// ---------------------------------------------------------------------------

/**
 * Emails one speaker an invitation into their portal (decisions.md D-070).
 *
 * `organizerName`/`organizerEmail` come from the signed-in admin, exactly as
 * the Communications screen's own sends do (D-053(2)): this is an
 * admin-initiated send, so "{{organizerName}}" must be the person who
 * pressed the button rather than the "The program team" fallback that
 * automated sends fall back to.
 *
 * Re-sending is deliberately allowed and unguarded — "I don't think that
 * arrived" is the normal reason to press this — and each send is its own
 * `portal_invite` row in `email_log`, which is what makes the record page's
 * email history a truthful account of who was invited and when.
 */
export async function sendSpeakerPortalInvite(eventSlug: string, speakerId: string) {
  const { event, user: admin } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const speaker = await loadRosterSpeaker(repos, event, speakerId);
  if (!speaker) return fail("That speaker isn't on this event's roster");

  const comms = await getCommsContext({
    repos,
    organizerName: admin.name?.trim() || admin.email,
    organizerEmail: admin.email,
  });

  let delivery;
  try {
    delivery = await sendPortalInvite(comms, { eventId: event.id, speakerId: speaker.id });
  } catch {
    return fail("Couldn't send the invitation — try again");
  }

  revalidatePath(`${rosterPath(eventSlug)}/${speaker.id}`);
  revalidatePath(`/admin/${eventSlug}/communications`);

  if (delivery.status === "failed") {
    return fail(delivery.error ?? "The invitation couldn't be delivered");
  }
  return { ok: true as const, data: { message: `Portal invitation sent to ${speaker.email}` } };
}
