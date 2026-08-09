"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { reviewRecommendationSchema, submissionDecisionSchema } from "@/db/entities";
import { sendChangeRequest } from "@/domain/comms";
import {
  canRecordDecision,
  canViewSubmission,
  recordDecision,
  saveReview,
} from "@/domain/review";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer, type SessionUser } from "@/lib/session";
import { reviewerTrackIdsFor } from "./queue";

/**
 * Review-flow writes (spec.md §4, §5).
 *
 * Two doors, deliberately different: any reviewer routed to the submission can
 * record a recommendation, but only an admin can record the binding decision —
 * accepting creates the session and the speaker's onboarding tasks and puts a
 * promise in writing (see canRecordDecision in src/domain/review.ts).
 *
 * Every write re-checks the viewer here rather than trusting the page that
 * rendered the button: a server action is a public endpoint.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * Resolves the submission for this event and confirms the viewer may act on
 * it. A submission the viewer can't see is reported as missing — whether it
 * exists is not their business.
 */
async function authorize(eventSlug: string, submissionId: string) {
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/submissions/${submissionId}`);
  const repos = await getRepos();

  const [event, submission] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.submissions.getById(submissionId),
  ]);
  if (!event || !submission || submission.eventId !== event.id) {
    return { ok: false as const, error: "Submission not found" };
  }

  const [trackIds, reviewerTrackIds] = await Promise.all([
    repos.submissions.listTrackIds(submission.id),
    reviewerTrackIdsFor(repos, viewer, event.id),
  ]);
  if (!canViewSubmission(viewer.role, reviewerTrackIds, trackIds)) {
    return { ok: false as const, error: "Submission not found" };
  }
  // An unsubmitted draft isn't in front of the committee (D-034, D-038).
  if (viewer.role !== "admin" && submission.status === "draft") {
    return { ok: false as const, error: "Submission not found" };
  }

  return { ok: true as const, repos, event, submission, viewer: viewer as SessionUser };
}

// ---------------------------------------------------------------------------
// Reviewer votes
// ---------------------------------------------------------------------------

const reviewInputSchema = z.object({
  /** "" clears the recommendation back to a comment-only review. */
  recommendation: z.union([reviewRecommendationSchema, z.literal("")]),
  comment: z.string().trim().max(4000, "That comment is too long").optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export async function saveMyReview(
  eventSlug: string,
  submissionId: string,
  input: ReviewInput,
) {
  const auth = await authorize(eventSlug, submissionId);
  if (!auth.ok) return fail(auth.error);

  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid review");

  if (!parsed.data.recommendation && !parsed.data.comment) {
    return fail("Pick a recommendation or leave a comment.");
  }

  try {
    await saveReview(
      { repos: auth.repos },
      {
        submissionId,
        reviewerId: auth.viewer.id,
        recommendation: parsed.data.recommendation || null,
        comment: parsed.data.comment ?? null,
      },
    );
    revalidatePath(`/admin/${eventSlug}/submissions`);
    revalidatePath(`/admin/${eventSlug}/submissions/${submissionId}`);
    return { ok: true as const };
  } catch {
    return fail("Couldn't save your review — try again");
  }
}

// ---------------------------------------------------------------------------
// The decision (admin only)
// ---------------------------------------------------------------------------

const decisionInputSchema = z.object({
  decision: submissionDecisionSchema,
  /** Feedback for the speaker; it goes into the decision email. */
  note: z.string().trim().max(4000, "That note is too long").optional(),
  /** Unchecked = record the outcome without emailing anyone yet. */
  notify: z.boolean().optional(),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

/**
 * Records accept / waitlist / decline. Accepting runs the conversion spec.md
 * §5 promises — session + onboarding tasks — and every outcome emails the
 * speakers through the real transport (spec.md §7).
 */
export async function decideSubmission(
  eventSlug: string,
  submissionId: string,
  input: DecisionInput,
) {
  const auth = await authorize(eventSlug, submissionId);
  if (!auth.ok) return fail(auth.error);
  if (!canRecordDecision(auth.viewer.role)) {
    return fail("Only an event admin can record the final decision.");
  }

  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision");

  const comms = await getCommsContext({ repos: auth.repos });

  let result;
  try {
    result = await recordDecision(
      { repos: auth.repos, comms },
      {
        submissionId,
        decision: parsed.data.decision,
        decidedBy: auth.viewer.id,
        note: parsed.data.note ?? null,
        notify: parsed.data.notify ?? true,
      },
    );
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Couldn't record the decision — try again",
    );
  }

  // Accepting reaches well beyond this page: a session lands on the agenda, a
  // speaker appears in the directory, and tasks show up in onboarding.
  revalidatePath(`/admin/${eventSlug}/submissions`);
  revalidatePath(`/admin/${eventSlug}/submissions/${submissionId}`);
  revalidatePath(`/admin/${eventSlug}/agenda`);
  revalidatePath(`/admin/${eventSlug}/speakers`);
  revalidatePath(`/admin/${eventSlug}/tasks`);
  revalidatePath(`/admin/${eventSlug}`);
  revalidatePath("/portal");

  const failed = result.deliveries.filter((delivery) => delivery.status === "failed");
  return {
    ok: true as const,
    data: {
      status: result.submission.status,
      sessionCreated: result.sessionCreated,
      assignmentsCreated: result.assignmentsCreated,
      emailsSent: result.deliveries.length - failed.length,
      emailsFailed: failed.length,
    },
  };
}

// ---------------------------------------------------------------------------
// "We need something from you first" (spec.md §7)
// ---------------------------------------------------------------------------

const changeRequestInputSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1, "Say what the speaker needs to change")
    .max(4000, "That request is too long"),
  /** A plain date from the form; "" means no deadline. */
  dueAt: z.string().trim().optional(),
  includeCoSpeakers: z.boolean().optional(),
});
export type ChangeRequestFormInput = z.infer<typeof changeRequestInputSchema>;

/**
 * Emails the submitter asking for a fix before review continues, without
 * deciding anything — the submission keeps its status and stays editable in
 * the speaker's portal (decisions.md D-022).
 *
 * Admin-only, like the decision: a request for changes arrives as the event
 * speaking, and it names a deadline that only the programme owner can promise.
 */
export async function requestChanges(
  eventSlug: string,
  submissionId: string,
  input: ChangeRequestFormInput,
) {
  const auth = await authorize(eventSlug, submissionId);
  if (!auth.ok) return fail(auth.error);
  if (!canRecordDecision(auth.viewer.role)) {
    return fail("Only an event admin can send a change request.");
  }

  const parsed = changeRequestInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request");

  // A date-only value is read as end of that day, so "by the 14th" includes
  // the 14th rather than expiring at midnight the night before.
  const dueAt = parsed.data.dueAt ? new Date(`${parsed.data.dueAt}T23:59:00`) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return fail("That deadline isn't a valid date");

  const comms = await getCommsContext({ repos: auth.repos });

  let deliveries;
  try {
    deliveries = await sendChangeRequest(comms, {
      submissionId,
      request: parsed.data.request,
      dueAt,
      includeCoSpeakers: parsed.data.includeCoSpeakers ?? false,
    });
  } catch {
    return fail("Couldn't send the request — try again");
  }

  // The communication log on the submission is part of what this page shows.
  revalidatePath(`/admin/${eventSlug}/submissions/${submissionId}`);

  const failed = deliveries.filter((delivery) => delivery.status === "failed");
  return {
    ok: true as const,
    data: { emailsSent: deliveries.length - failed.length, emailsFailed: failed.length },
  };
}
