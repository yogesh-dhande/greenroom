"use server";

import { revalidatePath } from "next/cache";
import { sendSubmissionConfirmation } from "@/domain/comms";
import { acceptsSubmissions, type FormValues } from "@/domain/forms";
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

  if (wasDraft) {
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
