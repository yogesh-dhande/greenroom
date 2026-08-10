"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { User } from "@/db/entities";
import type { DirectoryFilter } from "@/db/repos/contacts";
import type { Repos } from "@/db/repos";
import { checkTemplateDraft, type MergeData } from "@/domain/comms-templates";
import { sendManualEmail } from "@/domain/comms";
import { normalizeDirectoryFilter, normalizeTagLabel, TAG_MAX_LENGTH } from "@/domain/crm";
import { normalizeSegmentName, serializeSegmentQuery } from "@/domain/segments";
import {
  importProfilePatch,
  parseSpeakerCsv,
  summarizeImport,
  type SpeakerImportProblem,
  type SpeakerImportResultRow,
  type SpeakerImportRow,
  type SpeakerImportSummary,
} from "@/domain/speaker-import";
import { normalizeEmail } from "@/domain/team";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { ORG_MERGE_FIELDS, orgPortalUrl, orgSpeakerFields } from "./org-merge-fields";

/**
 * Writes behind the org-level contact directory (spec.md "Org-level speaker
 * CRM", decisions.md D-077).
 *
 * Every action re-guards with `requireAdmin` rather than trusting the (org)
 * layout that rendered the button: a server action is a public endpoint, and
 * the CRM is admin-only (roles are global, D-025). None of these writes is
 * event-scoped — the directory sits above events — so the only guard that
 * applies is the role one, plus each action's own existence checks.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

const DIRECTORY_PATH = "/admin/directory";

function profilePath(userId: string) {
  return `${DIRECTORY_PATH}/${userId}`;
}

// ---------------------------------------------------------------------------
// Manual contact creation and CSV import
// ---------------------------------------------------------------------------

/** The same field limits the event roster's add/import path uses, so a
 * contact and a speaker are the same record with the same rules. */
const contactFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "Keep the name under 120 characters"),
  title: z.string().trim().max(120, "Keep the title under 120 characters").optional(),
  company: z.string().trim().max(120, "Keep the company under 120 characters").optional(),
  bio: z.string().trim().max(2000, "Keep the bio under 2000 characters").optional(),
});

const addContactInputSchema = contactFieldsSchema.extend({
  email: z.email("Enter a valid email address"),
});
export type AddContactInput = z.infer<typeof addContactInputSchema>;

/**
 * Creates or reuses the person behind an address and registers them as an org
 * contact.
 *
 * Identity is global by email (decisions.md D-051), so this is deliberately
 * the *same* create-or-reuse rule the event roster applies: an address that
 * already has an account joins the directory rather than forking a second
 * record, and an import never overwrites what someone has saved on their own
 * profile — it only fills blanks (`importProfilePatch`).
 *
 * An existing account also keeps its role. An admin who is also a contact is
 * a normal arrangement, and demoting them here would revoke their access as
 * a side effect of a directory edit (decisions.md D-044(1)).
 */
async function createOrReuseContact(
  repos: Repos,
  row: Pick<SpeakerImportRow, "name" | "email" | "title" | "company" | "bio">,
  source: "manual" | "import",
): Promise<{ user: User; created: boolean; filled: string[] }> {
  const email = normalizeEmail(row.email);
  const existing = await repos.users.getByEmail(email);

  if (existing) {
    const patch = importProfilePatch(existing, row);
    const filled = Object.keys(patch);
    const user = filled.length > 0 ? await repos.users.update(existing.id, patch) : existing;
    // Idempotent: someone already in the registry keeps their original row
    // and its source, so re-adding them changes nothing.
    await repos.contacts.addToRegistry(user.id, source);
    return { user, created: false, filled };
  }

  // The row a magic link will land on, written exactly as the roster's own
  // creation path writes it (decisions.md D-044(3)) — better-auth adopts a
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
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
  });
  await repos.contacts.addToRegistry(user.id, source);
  return { user, created: true, filled: [] };
}

/**
 * The directory's manual "Add contact" (spec.md: manual contact creation) —
 * a prospect nobody has invited to an event yet, typed in by hand.
 */
export async function addContact(input: AddContactInput) {
  await requireAdmin(DIRECTORY_PATH);

  const parsed = addContactInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check those details");

  const repos = await getRepos();
  const email = normalizeEmail(parsed.data.email);

  let result: { user: User; created: boolean };
  try {
    result = await createOrReuseContact(
      repos,
      {
        name: parsed.data.name,
        email,
        title: parsed.data.title || null,
        company: parsed.data.company || null,
        bio: parsed.data.bio || null,
      },
      "manual",
    );
  } catch {
    return fail("Couldn't add that contact — try again");
  }

  revalidatePath(DIRECTORY_PATH);
  revalidatePath("/admin/crm");
  return {
    ok: true as const,
    data: {
      userId: result.user.id,
      message: result.created
        ? `${parsed.data.name} was added to the directory`
        : `${email} already had an account — linked the existing account to the directory`,
    },
  };
}

export interface ImportContactsResult {
  summary: SpeakerImportSummary;
  /** Lines the parser refused, with why — shown beside the per-row results. */
  problems: SpeakerImportProblem[];
}

/**
 * Org-level CSV import (spec.md: "same column rules as the event roster
 * import, deduplicating by email").
 *
 * Same pure parser as the roster's import (src/domain/speaker-import.ts) and
 * the same create-or-reuse write, minus the event: nobody lands on a roster
 * here, they land in the registry. Re-importing a file that has already been
 * imported therefore merges rather than duplicating, both within one file
 * (the parser folds repeated addresses) and across runs (the address lookup).
 *
 * Rows are written one at a time on purpose: one failing row must not cost
 * the organizer the other forty-nine.
 */
export async function importContacts(csv: string) {
  await requireAdmin(DIRECTORY_PATH);

  if (typeof csv !== "string" || csv.trim() === "") return fail("Paste some CSV first");
  if (csv.length > 500_000) return fail("That file is too big to import in one go");

  const { rows, problems } = parseSpeakerCsv(csv);
  const repos = await getRepos();
  const results: SpeakerImportResultRow[] = [];

  for (const row of rows) {
    try {
      const { user, created, filled } = await createOrReuseContact(repos, row, "import");
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

  revalidatePath(DIRECTORY_PATH);
  revalidatePath("/admin/crm");
  return {
    ok: true as const,
    data: { summary: summarizeImport(results), problems } satisfies ImportContactsResult,
  };
}

// ---------------------------------------------------------------------------
// Saved segments (spec.md: a filtered view saves under a name)
// ---------------------------------------------------------------------------

const saveSegmentInputSchema = z.object({
  name: z.string().max(80, "Keep the name under 80 characters"),
  filter: z.object({
    q: z.string().optional(),
    company: z.string().optional(),
    tag: z.string().optional(),
  }),
});
export type SaveSegmentInput = z.infer<typeof saveSegmentInputSchema>;

/**
 * Saves the current directory narrowing under a name.
 *
 * What's stored is the *question* — `serializeSegmentQuery` of the normalized
 * filter — never the answer, so reopening the segment re-runs the query and
 * reports whoever matches today. That is what makes a segment dynamic, and
 * why an empty filter is refused: a segment matching everyone is a name for
 * "the directory", not a saved view.
 */
export async function saveSegment(input: SaveSegmentInput) {
  const viewer = await requireAdmin(DIRECTORY_PATH);

  const parsed = saveSegmentInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check those details");

  const name = normalizeSegmentName(parsed.data.name);
  if (!name) return fail("Give the segment a name");

  const filter = normalizeDirectoryFilter(parsed.data.filter as DirectoryFilter);
  if (Object.keys(filter).length === 0) {
    return fail("Apply a filter first — a segment saves the criteria, not the whole directory");
  }

  const repos = await getRepos();
  let segmentId: string;
  try {
    const segment = await repos.segments.create({
      name,
      query: serializeSegmentQuery(filter),
      createdByUserId: viewer.id,
    });
    segmentId = segment.id;
  } catch {
    return fail("Couldn't save that segment — try again");
  }

  revalidatePath(DIRECTORY_PATH);
  return { ok: true as const, data: { segmentId, message: `Saved the segment "${name}"` } };
}

// ---------------------------------------------------------------------------
// Tags (spec.md: free-form tags; D-077 excludes custom-field builders)
// ---------------------------------------------------------------------------

const tagInputSchema = z.object({
  userId: z.string().min(1),
  label: z.string().max(TAG_MAX_LENGTH, `Keep tags under ${TAG_MAX_LENGTH} characters`),
});
export type TagInput = z.infer<typeof tagInputSchema>;

/** Adds one tag to one contact. Idempotent and normalizing in the repo, so a
 * re-typed tag is a no-op rather than a duplicate or a second casing. */
export async function addContactTag(input: TagInput) {
  await requireAdmin(DIRECTORY_PATH);

  const parsed = tagInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check that tag");

  const label = normalizeTagLabel(parsed.data.label);
  if (!label) return fail("Type a tag first");

  const repos = await getRepos();
  const detail = await repos.contacts.getDetail(parsed.data.userId);
  if (!detail) return fail("That contact no longer exists");

  try {
    await repos.contacts.addTag(detail.user.id, label);
  } catch {
    return fail("Couldn't add that tag — try again");
  }

  revalidatePath(profilePath(detail.user.id));
  revalidatePath(DIRECTORY_PATH);
  return { ok: true as const, data: { label, message: `Tagged "${label}"` } };
}

/** Removes one tag. A no-op when the contact doesn't carry it. */
export async function removeContactTag(input: TagInput) {
  await requireAdmin(DIRECTORY_PATH);

  const parsed = tagInputSchema.safeParse(input);
  if (!parsed.success) return fail("Check that tag");

  const label = normalizeTagLabel(parsed.data.label);
  if (!label) return fail("Check that tag");

  const repos = await getRepos();
  const detail = await repos.contacts.getDetail(parsed.data.userId);
  if (!detail) return fail("That contact no longer exists");

  try {
    await repos.contacts.removeTag(detail.user.id, label);
  } catch {
    return fail("Couldn't remove that tag — try again");
  }

  revalidatePath(profilePath(detail.user.id));
  revalidatePath(DIRECTORY_PATH);
  return { ok: true as const, data: { label, message: `Removed "${label}"` } };
}

// ---------------------------------------------------------------------------
// Org-level internal notes (spec.md: notes that persist across events)
// ---------------------------------------------------------------------------

const noteInputSchema = z.object({
  userId: z.string().min(1),
  body: z.string().trim().min(1, "Write something first").max(4000, "Keep notes under 4000 characters"),
});
export type ContactNoteInput = z.infer<typeof noteInputSchema>;

/**
 * Appends an internal note to a contact.
 *
 * Org-level and append-only, which is what separates it from the event
 * record's single logistics field (D-051): "strong on CI topics; shortlist
 * for keynote" is true of the person, not of one event, and the note stays
 * legible as a dated trail rather than being overwritten by the next editor.
 * Never shown to the contact.
 */
export async function addContactNote(input: ContactNoteInput) {
  const viewer = await requireAdmin(DIRECTORY_PATH);

  const parsed = noteInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Couldn't save that note");

  const repos = await getRepos();
  const detail = await repos.contacts.getDetail(parsed.data.userId);
  if (!detail) return fail("That contact no longer exists");

  try {
    await repos.contacts.addNote({
      userId: detail.user.id,
      authorUserId: viewer.id,
      body: parsed.data.body,
    });
  } catch {
    return fail("Couldn't save that note — try again");
  }

  revalidatePath(profilePath(detail.user.id));
  return { ok: true as const, data: { message: "Note added" } };
}

// ---------------------------------------------------------------------------
// Add to event (spec.md: profile data carries over without re-entry, D-051)
// ---------------------------------------------------------------------------

const addToEventInputSchema = z.object({
  userId: z.string().min(1),
  /** An event id or its slug — the picker sends the id, but a slug is the
   * thing an organizer would hand-write, so both resolve. */
  event: z.string().min(1, "Pick an event"),
});
export type AddContactToEventInput = z.infer<typeof addToEventInputSchema>;

/**
 * Attaches an org contact to one event's roster.
 *
 * Nothing is copied: identity is global by email (decisions.md D-051), so the
 * name, title, company, bio and headshot the directory already holds *are*
 * what the event roster reads. The write is a single `event_speakers` row,
 * idempotent like every other roster membership, so pressing this twice is a
 * no-op rather than a duplicate.
 */
export async function addContactToEvent(input: AddContactToEventInput) {
  await requireAdmin(DIRECTORY_PATH);

  const parsed = addToEventInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Pick an event");

  const repos = await getRepos();
  const detail = await repos.contacts.getDetail(parsed.data.userId);
  if (!detail) return fail("That contact no longer exists");

  const event =
    (await repos.events.getById(parsed.data.event)) ??
    (await repos.events.getBySlug(parsed.data.event));
  if (!event) return fail("That event no longer exists");

  const alreadyLinked = detail.events.some((link) => link.eventId === event.id);

  try {
    await repos.eventSpeakers.add(event.id, detail.user.id);
  } catch {
    return fail("Couldn't add them to that event — try again");
  }

  revalidatePath(profilePath(detail.user.id));
  revalidatePath(DIRECTORY_PATH);
  revalidatePath(`/admin/${event.slug}/speakers`);
  return {
    ok: true as const,
    data: {
      eventSlug: event.slug,
      eventName: event.name,
      alreadyLinked,
      message: alreadyLinked
        ? `${detail.user.name ?? detail.user.email} was already on ${event.name}`
        : `${detail.user.name ?? detail.user.email} was added to ${event.name}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Bulk outreach (spec.md: select contacts and email them with merge tags)
// ---------------------------------------------------------------------------

const directoryEmailSchema = z.object({
  recipientIds: z.array(z.string()).min(1, "Pick at least one recipient"),
  subject: z.string().trim().min(1, "Give the message a subject").max(200, "That subject is too long"),
  body: z.string().trim().min(1, "The message body can't be empty").max(20_000, "That message is too long"),
});
export type DirectoryEmailInput = z.infer<typeof directoryEmailSchema>;

/**
 * Sends one composed message to several directory contacts (spec.md: "select
 * directory contacts and email them with the merge-tag composer").
 *
 * The event composer's send path (`sendComposedEmail`) with the event taken
 * out. Merge data is assembled **per recipient**, so one composition to eight
 * people is eight personalised emails rather than one message with eight
 * names on it — and because `email_log` is keyed by address rather than by
 * event (D-065), each send lands on that contact's own activity feed with no
 * extra plumbing.
 *
 * The available field list is `ORG_MERGE_FIELDS`, which is narrower than the
 * event composer's: with no event there is no `{{eventName}}` to promise.
 * The same `checkTemplateDraft` the dialog runs live is re-run here, because
 * a draft referencing a field this path can't fill would arrive with a hole
 * in it and nobody re-reads mail after it's sent.
 */
export async function sendDirectoryEmail(input: DirectoryEmailInput) {
  const viewer = await requireAdmin(DIRECTORY_PATH);

  const parsed = directoryEmailSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid message");

  const check = checkTemplateDraft(parsed.data.subject, parsed.data.body, ORG_MERGE_FIELDS);
  if (check.errors.length > 0) return fail(check.errors[0]);

  const repos = await getRepos();
  const recipients = await repos.users.listByIds(parsed.data.recipientIds);
  if (recipients.length === 0) return fail("Couldn't find those recipients");

  // The acting admin signs the mail, not the "The program team" fallback:
  // this is an admin-initiated send (decisions.md D-053(2)).
  const comms = await getCommsContext({
    repos,
    organizerName: viewer.name?.trim() || viewer.email,
    organizerEmail: viewer.email,
  });

  const orgFields: MergeData = {
    organizerName: comms.organizerName ?? viewer.email,
    organizerEmail: comms.organizerEmail ?? viewer.email,
    portalUrl: orgPortalUrl(comms.appUrl),
  };

  let sent = 0;
  const failures: string[] = [];
  for (const user of recipients) {
    try {
      const delivery = await sendManualEmail(comms, {
        template: { subject: parsed.data.subject, body: parsed.data.body },
        to: user.email,
        data: { ...orgFields, ...orgSpeakerFields(user) },
        log: { kind: "manual", relatedType: "user", relatedId: user.id },
      });
      if (delivery.status === "sent") sent += 1;
      else failures.push(`${user.email}: ${delivery.error ?? "delivery failed"}`);
    } catch (error) {
      failures.push(`${user.email}: ${error instanceof Error ? error.message : "send failed"}`);
    }
  }

  revalidatePath(DIRECTORY_PATH);
  for (const user of recipients) revalidatePath(profilePath(user.id));
  return { ok: true as const, data: { sent, failed: failures.length, failures } };
}
