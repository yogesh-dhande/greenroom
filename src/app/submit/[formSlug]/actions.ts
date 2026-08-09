"use server";

import { revalidatePath } from "next/cache";
import { RESERVED_FIELD_IDS, type Event, type Form, type Track } from "@/db/entities";
import { sendDraftSavedLink, sendSubmissionConfirmation } from "@/domain/comms";
import { acceptsSubmissions, submissionLimitMessage, type FormValues } from "@/domain/forms";
import { saveSubmission, speakerLimitState } from "@/domain/submissions";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import type { SchemaFormResult } from "@/components/schema-form/types";

interface SubmitContext {
  repos: Awaited<ReturnType<typeof getRepos>>;
  form: Form;
  event: Event;
  tracks: Track[];
}

/**
 * Re-resolves everything the save needs from the slug alone, and re-checks the
 * window: a tab left open past the deadline must not sneak a submission in.
 */
async function openForm(formSlug: string): Promise<SubmitContext | string> {
  const repos = await getRepos();
  const form = await repos.forms.getBySlug(formSlug);
  if (!form || !form.isPublished) return "That form isn't available.";
  if (!acceptsSubmissions(form)) return "This call for speakers has closed.";

  const event = await repos.events.getById(form.eventId);
  if (!event) return "That form isn't available.";

  return { repos, form, event, tracks: await repos.tracks.listByEvent(event.id) };
}

function submitterEmail(values: FormValues): string {
  const value = values[RESERVED_FIELD_IDS.speakerEmail];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The per-form cap, re-checked at save time (decisions.md D-034, D-038). The page
 * already refuses to render a form for a signed-in speaker who is out of
 * slots, but an anonymous visitor is only identifiable by the address they
 * type — so this is where the rule is actually enforced.
 */
async function limitRefusal(
  ctx: SubmitContext,
  values: FormValues,
  submissionId: string | null,
): Promise<SchemaFormResult | null> {
  if (ctx.form.maxSubmissionsPerSpeaker === null) return null;
  const state = await speakerLimitState({ repos: ctx.repos }, ctx.form, submitterEmail(values), {
    excludeId: submissionId ?? undefined,
  });
  if (!state.atLimit || state.limit === null) return null;
  return { ok: false, error: submissionLimitMessage(state.limit) };
}

/**
 * Resolves the draft a resume token points at. These public actions never
 * accept a raw submission id: a server action is an open endpoint anyone can
 * invoke with arguments of their choosing, and submission ids are visible to
 * reviewers, in portal URLs and in emails — so possession of the emailed
 * secret (decisions.md D-038: the link *is* the authentication) is the only
 * way to write to an existing proposal from here.
 */
async function draftIdFromToken(
  ctx: SubmitContext,
  resumeToken: string | null,
): Promise<{ ok: true; submissionId: string | null } | { ok: false; error: string }> {
  if (!resumeToken) return { ok: true, submissionId: null };
  const submission = await ctx.repos.submissions.getByResumeToken(resumeToken);
  if (!submission || submission.formId !== ctx.form.id) {
    return { ok: false, error: "That draft link isn't valid." };
  }
  if (submission.status !== "draft") {
    return {
      ok: false,
      error:
        "This proposal has already been submitted — you can review it from your speaker portal.",
    };
  }
  return { ok: true, submissionId: submission.id };
}

/**
 * Accepts a proposal from the public CFP page (spec.md §3 — no login
 * required). `resumeToken` is set only when a saved draft is being finished
 * (decisions.md D-034, D-038), in which case this promotes it to "submitted".
 */
export async function submitProposal(
  formSlug: string,
  resumeToken: string | null,
  values: FormValues,
): Promise<SchemaFormResult> {
  const ctx = await openForm(formSlug);
  if (typeof ctx === "string") return { ok: false, error: ctx };

  const draft = await draftIdFromToken(ctx, resumeToken);
  if (!draft.ok) return { ok: false, error: draft.error };
  const submissionId = draft.submissionId;

  const refusal = await limitRefusal(ctx, values, submissionId);
  if (refusal) return refusal;

  const result = await saveSubmission(
    { repos: ctx.repos },
    {
      form: ctx.form,
      event: ctx.event,
      tracks: ctx.tracks,
      values,
      submissionId: submissionId ?? undefined,
      status: "submitted",
    },
  );
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

  revalidatePath(`/admin/${ctx.event.slug}/submissions`);
  revalidatePath(`/admin/${ctx.event.slug}/forms`);

  return {
    ok: true,
    message: "Proposal received.",
    redirectTo: `/submit/${ctx.form.slug}/thanks/${result.submission.id}`,
  };
}

/**
 * Saves an unfinished proposal (decisions.md D-034, D-038).
 *
 * Required questions are relaxed — half an abstract is exactly what a draft
 * is — but format, choice and length rules still apply, so a draft can never
 * hold an answer the finished form would reject. The speaker is emailed the
 * link back, and the browser is moved onto that same link so the next "Save
 * draft" updates this draft instead of starting another.
 */
export async function saveDraft(
  formSlug: string,
  resumeToken: string | null,
  values: FormValues,
): Promise<SchemaFormResult> {
  const ctx = await openForm(formSlug);
  if (typeof ctx === "string") return { ok: false, error: ctx };

  const draft = await draftIdFromToken(ctx, resumeToken);
  if (!draft.ok) return { ok: false, error: draft.error };
  const submissionId = draft.submissionId;

  if (!submitterEmail(values)) {
    return {
      ok: false,
      error: "Add your email address first — it's where we send the link back to this draft.",
      fieldErrors: { [RESERVED_FIELD_IDS.speakerEmail]: "We need this to save your draft" },
    };
  }

  const refusal = await limitRefusal(ctx, values, submissionId);
  if (refusal) return refusal;

  const result = await saveSubmission(
    { repos: ctx.repos },
    {
      form: ctx.form,
      event: ctx.event,
      tracks: ctx.tracks,
      values,
      submissionId: submissionId ?? undefined,
      status: "draft",
    },
  );
  if (!result.ok) return result;

  try {
    await sendDraftSavedLink(await getCommsContext(), { submissionId: result.submission.id });
  } catch (error) {
    console.error("draft link email failed", error);
  }

  revalidatePath(`/admin/${ctx.event.slug}/submissions`);

  const token = result.submission.resumeToken;
  return {
    ok: true,
    message: "Draft saved — we've emailed you the link back to it.",
    redirectTo: token ? `/submit/${ctx.form.slug}/resume/${token}` : undefined,
  };
}
