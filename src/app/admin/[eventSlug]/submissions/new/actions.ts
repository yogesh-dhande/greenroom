"use server";

import { revalidatePath } from "next/cache";
import { createsSessionsDirectly } from "@/db/entities";
import type { FormValues } from "@/domain/forms";
import { acceptOnArrival } from "@/domain/review";
import { saveSubmission } from "@/domain/submissions";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import type { SchemaFormResult } from "@/components/schema-form/types";

/**
 * Enters a proposal on a speaker's behalf (spec.md §2, decisions.md D-034, D-038).
 *
 * Organizers are handed talks outside the form all the time — a hallway
 * conversation, an invited keynote, an emailed abstract — and until now those
 * had nowhere to live. This runs the same schema, the same validator and the
 * same `saveSubmission` as the public page, so a manually entered proposal is
 * indistinguishable downstream: it reviews, gets decided, and schedules like
 * any other.
 *
 * Three deliberate differences from the public path: the submission window and
 * publish state are ignored (an organizer typing this in is the authority on
 * whether it's accepted), the per-speaker cap doesn't apply for the same
 * reason, and no confirmation email is sent — the speaker never touched a form
 * and shouldn't get mail about one they didn't fill in.
 */
export async function createSubmissionOnBehalf(
  eventSlug: string,
  formId: string,
  values: FormValues,
): Promise<SchemaFormResult> {
  await requireAdmin(`/admin/${eventSlug}/submissions/new`);

  const repos = await getRepos();
  const [event, form] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.forms.getById(formId),
  ]);
  if (!event || !form || form.eventId !== event.id) {
    return { ok: false, error: "That form no longer exists." };
  }

  // `saveSubmission` re-resolves the question list from the stored schema, so
  // a stale tab can't submit against questions that have since changed.
  const tracks = await repos.tracks.listByEvent(event.id);
  const result = await saveSubmission(
    { repos },
    { form, event, tracks, values, status: "submitted" },
  );
  if (!result.ok) return result;

  // Entered against a session-type form, it becomes a confirmed session right
  // away — same conversion an accept runs (decisions.md D-041).
  const converted = createsSessionsDirectly(form);
  if (converted) {
    await acceptOnArrival({ repos }, { submissionId: result.submission.id });
  }

  revalidatePath(`/admin/${eventSlug}/submissions`);
  revalidatePath(`/admin/${eventSlug}/forms`);
  if (converted) {
    revalidatePath(`/admin/${eventSlug}/agenda`);
    revalidatePath(`/admin/${eventSlug}/speakers`);
    revalidatePath(`/admin/${eventSlug}/tasks`);
  }

  return {
    ok: true,
    message: converted ? "Proposal added — it's now a confirmed session." : "Proposal added.",
    redirectTo: `/admin/${eventSlug}/submissions/${result.submission.id}`,
  };
}
