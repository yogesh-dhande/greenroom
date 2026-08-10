"use server";

import { revalidatePath } from "next/cache";
import { createsSessionsDirectly } from "@/db/entities";
import { sendSubmissionConfirmation } from "@/domain/comms";
import { acceptsSubmissions, type FormValues } from "@/domain/forms";
import { acceptOnArrival } from "@/domain/review";
import { loadSubmissionDetail, saveSubmission } from "@/domain/submissions";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import type { SchemaFormResult } from "@/components/schema-form/types";

/**
 * A speaker updating their own proposal (spec.md §3 — submissions stay
 * editable while the call is open).
 *
 * Every guard is re-checked here rather than trusted from the page that
 * rendered the form: the caller is a client component, and the submission id
 * is a bound argument a determined visitor can change.
 */
export async function updateOwnSubmission(
  submissionId: string,
  values: FormValues,
): Promise<SchemaFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in again to save your changes." };

  const repos = await getRepos();
  const detail = await loadSubmissionDetail({ repos }, submissionId);
  if (!detail) return { ok: false, error: "That proposal no longer exists." };

  // Primary speaker or co-speaker only — a signed-in speaker must not be able
  // to edit someone else's proposal by guessing an id.
  if (!detail.speakerIds.includes(user.id)) {
    return { ok: false, error: "This proposal isn't yours to edit." };
  }

  if (!acceptsSubmissions(detail.form)) {
    return { ok: false, error: "Editing has closed for this call for speakers." };
  }

  // A draft the speaker happens to be signed in for is reachable here as well
  // as through its emailed link, and this form validates everything a finished
  // proposal needs — so saving it finishes it (decisions.md D-034, D-038).
  // Without this the portal is a dead end: a draft edited here would stay a
  // draft with no way to send it.
  const wasDraft = detail.submission.status === "draft";

  const result = await saveSubmission(
    { repos },
    {
      form: detail.form,
      event: detail.event,
      tracks: detail.tracks,
      values,
      submissionId: detail.submission.id,
      status: wasDraft ? "submitted" : undefined,
    },
  );
  if (!result.ok) return result;

  // Finishing a draft here is the same product event as finishing it on the
  // public page, so it takes the same two steps in the same order: a
  // session-type form's proposal is accepted on arrival and becomes a confirmed
  // (unscheduled) session (decisions.md D-041), and only then is the
  // confirmation email sent — no decision email either way (D-042). Without
  // this, a session-type proposal completed through the portal never got its
  // session at all. A failure leaves an ordinary submitted proposal an
  // organizer can accept by hand rather than losing the proposal.
  if (wasDraft) {
    if (createsSessionsDirectly(detail.form)) {
      try {
        await acceptOnArrival({ repos }, { submissionId: result.submission.id });
      } catch (error) {
        console.error("direct-to-session conversion failed", error);
      }
    }

    try {
      await sendSubmissionConfirmation(await getCommsContext(), {
        submissionId: result.submission.id,
        includeCoSpeakers: true,
      });
    } catch (error) {
      console.error("submission confirmation email failed", error);
    }
  }

  revalidatePath(`/portal/submissions/${submissionId}`);
  revalidatePath(`/portal`);
  revalidatePath(`/admin/${detail.event.slug}/submissions`);
  // A save here reaches the session an accepted proposal became: its speaker
  // set, its abstract and its speakers' onboarding tasks all move with the edit
  // (src/domain/submissions.ts `saveSubmission`), and a session-type draft
  // finished above creates that session outright. Those are what these surfaces
  // render (decisions.md D-017, D-071, spec.md §8) — the speaker/program paths
  // are the same ones src/app/portal/profile/actions.ts revalidates.
  revalidatePath(`/admin/${detail.event.slug}/speakers`);
  revalidatePath(`/admin/${detail.event.slug}/agenda`);
  revalidatePath(`/admin/${detail.event.slug}/tasks`);
  revalidatePath(`/p/${detail.event.slug}/speakers`);
  revalidatePath(`/p/${detail.event.slug}/schedule`);
  revalidatePath(`/embed/${detail.event.slug}/speakers`);
  revalidatePath(`/embed/${detail.event.slug}/schedule`);

  return {
    ok: true,
    // Matches the public thanks page's wording (spec.md §3, §7) — submitting
    // a draft here takes the same confirmation-email path, so it should read
    // like the same product event rather than a quieter portal-only save.
    message: wasDraft
      ? `Proposal submitted. A confirmation email is on its way to ${result.primarySpeaker.email}.`
      : "Your proposal has been updated.",
  };
}
