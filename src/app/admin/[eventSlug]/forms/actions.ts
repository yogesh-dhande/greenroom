"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formFieldsSchema, formTypeSchema, type FormField, type FormType } from "@/db/entities";
import {
  defaultFormDraft,
  fieldSchemaProblems,
  fromZonedInputValue,
  normalizeFormFields,
  unknownMergePlaceholders,
} from "@/domain/forms";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { SLUG_PATTERN, slugify } from "@/lib/slug";

function fail(error: string) {
  return { ok: false as const, error };
}

/** A slug nobody else is using — form slugs are globally unique because they
 * are the whole public URL (/submit/{slug}). */
async function uniqueSlug(
  repos: Awaited<ReturnType<typeof getRepos>>,
  base: string,
  ignoreId?: string,
): Promise<string> {
  const root = slugify(base) || "call-for-speakers";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const existing = await repos.forms.getBySlug(candidate);
    if (!existing || existing.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * A new form starts as a complete, standard CFP — welcome copy, the usual
 * questions, confirmation copy — rather than a blank canvas an organizer has
 * to assemble from nothing.
 */
export async function createForm(eventSlug: string, name: string, type: FormType = "abstract") {
  await requireAdmin(`/admin/${eventSlug}/forms`);

  const trimmed = name.trim();
  if (!trimmed) return fail("Give the form a name");
  const parsedType = formTypeSchema.safeParse(type);
  if (!parsedType.success) return fail("Pick what submissions to this form become");

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("That event no longer exists");

  const draft = defaultFormDraft(trimmed);
  try {
    const form = await repos.forms.create({
      eventId: event.id,
      name: draft.name,
      slug: await uniqueSlug(repos, trimmed),
      type: parsedType.data,
      welcomeCopy: draft.welcomeCopy,
      fields: draft.fields,
      opensAt: null,
      closesAt: null,
      confirmationPageContent: draft.confirmationPageContent,
      confirmationEmailSubject: draft.confirmationEmailSubject,
      confirmationEmailBody: draft.confirmationEmailBody,
      maxSubmissionsPerSpeaker: null,
      isPublished: false,
    });
    revalidatePath(`/admin/${eventSlug}/forms`);
    return { ok: true as const, data: { formId: form.id } };
  } catch {
    return fail("Couldn't create the form — try again");
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const saveFormInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "The public link needs a slug")
    .regex(SLUG_PATTERN, "Lowercase letters, numbers, and hyphens only"),
  /** Review pipeline or direct-to-session (decisions.md D-041). */
  type: formTypeSchema,
  welcomeCopy: z.string(),
  fields: formFieldsSchema,
  /** "YYYY-MM-DDTHH:MM" wall-clock in the event's timezone, or "". */
  opensAt: z.string(),
  closesAt: z.string(),
  confirmationPageContent: z.string(),
  confirmationEmailSubject: z.string(),
  confirmationEmailBody: z.string(),
  /** "" = no cap; otherwise a positive whole number (D-034, D-038). */
  maxSubmissionsPerSpeaker: z.string(),
});
export type SaveFormInput = z.infer<typeof saveFormInputSchema>;

export async function saveForm(eventSlug: string, formId: string, input: SaveFormInput) {
  await requireAdmin(`/admin/${eventSlug}/forms`);

  const parsed = saveFormInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Something in the form is off");
  const v = parsed.data;

  // Fixed before validation, not rejected: a co-speaker block can never be
  // required (spec.md §2, D-034, D-038), and a character cap on a field type that
  // has no text is meaningless. Both are stripped here rather than trusted
  // from the client, so no payload — hand-crafted or from a stale tab — can
  // store a form that demands a co-speaker.
  const fields = normalizeFormFields(v.fields as FormField[]);

  // The renderer can't do anything sensible with a broken schema (a select
  // with no choices, a condition pointing at a deleted question), so it never
  // reaches the database.
  const problems = fieldSchemaProblems(fields);
  if (problems.length > 0) return fail(problems[0]);

  const maxPerSpeaker = v.maxSubmissionsPerSpeaker.trim();
  const limit = maxPerSpeaker === "" ? null : Number(maxPerSpeaker);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    return fail("Proposals per speaker has to be a whole number, 1 or more — or blank for no limit");
  }

  const repos = await getRepos();
  const [event, form] = await Promise.all([repos.events.getBySlug(eventSlug), repos.forms.getById(formId)]);
  if (!event || !form || form.eventId !== event.id) return fail("That form no longer exists");

  if (v.slug !== form.slug) {
    const clash = await repos.forms.getBySlug(v.slug);
    if (clash && clash.id !== form.id) return fail("That link is already used by another form");
  }

  // Switching type once proposals exist would retroactively change what they
  // are — accepted sessions back into review work, or reviewed abstracts out of
  // the queue without a decision (decisions.md D-041).
  if (v.type !== form.type) {
    const counts = await repos.submissions.countByForms([form.id]);
    if ((counts[form.id] ?? 0) > 0) {
      return fail("This form already has submissions — its type can't change now");
    }
  }

  // Wall-clock in, instant out: an organizer types "5:00 PM" meaning 5pm where
  // the conference is, not 5pm wherever their laptop thinks it is.
  const opensAt = fromZonedInputValue(v.opensAt, event.timezone);
  const closesAt = fromZonedInputValue(v.closesAt, event.timezone);
  if (opensAt && closesAt && closesAt <= opensAt) {
    return fail("The close date has to be after the open date");
  }

  try {
    await repos.forms.update(form.id, {
      name: v.name,
      slug: v.slug,
      type: v.type,
      welcomeCopy: v.welcomeCopy.trim() || null,
      fields,
      opensAt,
      closesAt,
      confirmationPageContent: v.confirmationPageContent.trim() || null,
      confirmationEmailSubject: v.confirmationEmailSubject.trim() || null,
      confirmationEmailBody: v.confirmationEmailBody.trim() || null,
      maxSubmissionsPerSpeaker: limit,
    });
  } catch {
    return fail("Couldn't save the form — try again");
  }

  revalidatePath(`/admin/${eventSlug}/forms`);
  revalidatePath(`/admin/${eventSlug}/forms/${form.id}`);
  revalidatePath(`/submit/${v.slug}`);
  if (v.slug !== form.slug) revalidatePath(`/submit/${form.slug}`);

  return {
    ok: true as const,
    // Placeholders that will render empty for every speaker (decisions.md
    // D-020) — worth telling the organizer about, not worth blocking a save.
    data: {
      slug: v.slug,
      unknownPlaceholders: unknownMergePlaceholders(
        `${v.confirmationEmailSubject}\n${v.confirmationEmailBody}`,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Publish / unpublish / delete
// ---------------------------------------------------------------------------

export async function setFormPublished(eventSlug: string, formId: string, isPublished: boolean) {
  await requireAdmin(`/admin/${eventSlug}/forms`);

  const repos = await getRepos();
  const form = await repos.forms.getById(formId);
  if (!form) return fail("That form no longer exists");

  if (isPublished && fieldSchemaProblems(form.fields).length > 0) {
    return fail("Fix the questions flagged below before publishing");
  }

  try {
    await repos.forms.update(form.id, { isPublished });
  } catch {
    return fail("Couldn't update the form — try again");
  }

  revalidatePath(`/admin/${eventSlug}/forms`);
  revalidatePath(`/admin/${eventSlug}/forms/${form.id}`);
  revalidatePath(`/submit/${form.slug}`);
  return { ok: true as const };
}

export async function deleteForm(eventSlug: string, formId: string) {
  await requireAdmin(`/admin/${eventSlug}/forms`);

  const repos = await getRepos();
  const form = await repos.forms.getById(formId);
  if (!form) return fail("That form no longer exists");

  // Deleting a form would cascade its submissions away with it — an organizer
  // who has real proposals should unpublish, not delete.
  const counts = await repos.submissions.countByForms([form.id]);
  if ((counts[form.id] ?? 0) > 0) {
    return fail("This form has submissions — unpublish it instead of deleting it");
  }

  try {
    await repos.forms.delete(form.id);
  } catch {
    return fail("Couldn't delete the form — try again");
  }

  revalidatePath(`/admin/${eventSlug}/forms`);
  return { ok: true as const };
}
