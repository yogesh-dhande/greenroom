"use server";

import { revalidatePath } from "next/cache";
import { sendSubmissionConfirmation } from "@/domain/comms";
import { acceptsSubmissions, type FormValues } from "@/domain/forms";
import { saveSubmission } from "@/domain/submissions";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import type { SchemaFormResult } from "@/components/schema-form/types";

/**
 * Accepts a proposal from the public CFP page (spec.md §3 — no login
 * required).
 *
 * The window is re-checked here, not just when the page rendered: a tab left
 * open past the deadline must not sneak a submission in.
 */
export async function submitProposal(
  formSlug: string,
  values: FormValues,
): Promise<SchemaFormResult> {
  const repos = await getRepos();
  const form = await repos.forms.getBySlug(formSlug);
  if (!form || !form.isPublished) return { ok: false, error: "That form isn't available." };
  if (!acceptsSubmissions(form)) {
    return { ok: false, error: "This call for speakers has closed." };
  }

  const event = await repos.events.getById(form.eventId);
  if (!event) return { ok: false, error: "That form isn't available." };

  const tracks = await repos.tracks.listByEvent(event.id);
  const result = await saveSubmission({ repos }, { form, event, tracks, values });
  if (!result.ok) return result;

  // A confirmation email that fails to send must not lose the proposal — it's
  // saved, and the speaker is looking at the confirmation page either way
  // (the failure is visible in the server log, and successful sends land in
  // email_log via the comms layer).
  try {
    await sendSubmissionConfirmation(await getCommsContext(), {
      submissionId: result.submission.id,
      includeCoSpeakers: true,
    });
  } catch (error) {
    console.error("submission confirmation email failed", error);
  }

  revalidatePath(`/admin/${event.slug}/submissions`);
  revalidatePath(`/admin/${event.slug}/forms`);

  return {
    ok: true,
    message: "Proposal received.",
    redirectTo: `/submit/${form.slug}/thanks/${result.submission.id}`,
  };
}
