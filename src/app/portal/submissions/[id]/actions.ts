"use server";

import { revalidatePath } from "next/cache";
import { acceptsSubmissions, type FormValues } from "@/domain/forms";
import { loadSubmissionDetail, saveSubmission } from "@/domain/submissions";
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

  const result = await saveSubmission(
    { repos },
    {
      form: detail.form,
      event: detail.event,
      tracks: detail.tracks,
      values,
      submissionId: detail.submission.id,
    },
  );
  if (!result.ok) return result;

  revalidatePath(`/portal/submissions/${submissionId}`);
  revalidatePath(`/admin/${detail.event.slug}/submissions`);

  return { ok: true, message: "Your proposal has been updated." };
}
