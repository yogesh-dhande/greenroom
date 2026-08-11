"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { submissionDecisionSchema } from "@/db/entities";
import { decideSubmission as decideAdminSubmission } from "@/domain/admin-api";
import { sendChangeRequest } from "@/domain/comms";
import { canRecordDecision, canViewSubmission } from "@/domain/review";
import { updateSubmissionTracks } from "@/domain/submissions";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireAdminOrReviewer, type SessionUser } from "@/lib/session";
import { reviewerTrackIdsFor } from "./queue";

/**
 * Review-flow writes (spec.md §4, §5).
 *
 * Reviewers evaluate explicit round assignments through scorecards; only an
 * admin records the binding decision. Accepting creates the session and the
 * speaker's onboarding tasks and puts a promise in writing (see
 * canRecordDecision in src/domain/review.ts).
 *
 * Every write re-checks the viewer here rather than trusting the page that
 * rendered the button: a server action is a public endpoint.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * The `{{organizerName}}`/`{{organizerEmail}}` merge tokens for mail this
 * admin triggers by hand - the acting admin's own identity, not the generic
 * `DEFAULT_ORGANIZER_NAME` signature or the no-reply transport address
 * (decisions.md D-053, same pattern as
 * src/app/admin/[eventSlug]/communications/actions.ts's
 * `organizerNameFor`/`organizerEmailFor`). Automated/cron sends have no
 * acting user and keep the fallbacks (see src/domain/comms.ts `eventFields`).
 */
function organizerIdentityFor(viewer: { name: string | null; email: string }) {
  return { organizerName: viewer.name?.trim() || viewer.email, organizerEmail: viewer.email };
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
 * §5 promises — session + onboarding tasks. The shared workflow owns D-028's
 * email defaults (accept/decline on, waitlist off), while the explicit UI
 * checkbox remains an override.
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

  const comms = await getCommsContext({ repos: auth.repos, ...organizerIdentityFor(auth.viewer) });

  let result;
  try {
    result = await decideAdminSubmission(
      { repos: auth.repos, comms },
      auth.event.id,
      submissionId,
      auth.viewer.id,
      {
        decision: parsed.data.decision,
        note: parsed.data.note ?? null,
        notify: parsed.data.notify,
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

  const comms = await getCommsContext({ repos: auth.repos, ...organizerIdentityFor(auth.viewer) });

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

// ---------------------------------------------------------------------------
// Tracks (product gap: a submission with none is unreachable by every
// reviewer — see updateSubmissionTracks in src/domain/submissions.ts)
// ---------------------------------------------------------------------------

const updateTracksInputSchema = z.object({
  trackIds: z.array(z.string()),
});
export type UpdateSubmissionTracksInput = z.infer<typeof updateTracksInputSchema>;

/**
 * Sets a submission's tracks from the admin record (spec.md §4). Admin-only —
 * routing a talk isn't a reviewer's call, and a reviewer widening their own
 * reach by adding one of their tracks to a submission is exactly the access
 * this guards against.
 */
export async function setSubmissionTracks(
  eventSlug: string,
  submissionId: string,
  input: UpdateSubmissionTracksInput,
) {
  const auth = await authorize(eventSlug, submissionId);
  if (!auth.ok) return fail(auth.error);
  if (auth.viewer.role !== "admin") {
    return fail("Only an event admin can set a submission's tracks.");
  }

  const parsed = updateTracksInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid tracks");

  const result = await updateSubmissionTracks(
    { repos: auth.repos },
    submissionId,
    parsed.data.trackIds,
  );
  if (!result.ok) return fail(result.error);

  // Tracks are the routing key a reviewer's queue is built from
  // (isRoutedToReviewer, src/domain/review.ts), so every surface built on
  // them has to see the change: the queue itself, this record, and the
  // Overview counts that now reuse the same visibility predicate.
  revalidatePath(`/admin/${eventSlug}/submissions`);
  revalidatePath(`/admin/${eventSlug}/submissions/${submissionId}`);
  revalidatePath(`/admin/${eventSlug}`);
  return { ok: true as const };
}
