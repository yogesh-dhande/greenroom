"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scorecardCriterionTypeSchema } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { fromZonedInputValue } from "@/domain/forms";
import { canAssignReviewer } from "@/domain/review";
import {
  canScoreSubmission,
  criteriaEqual,
  isRoundOpen,
  normalizeCriteria,
  pickScorecardValues,
  validateScorecard,
} from "@/domain/rounds";
import { getRepos } from "@/lib/db";
import { requireAdmin, requireAdminOrReviewer } from "@/lib/session";
import { directSessionFormIds } from "../submissions/queue";
import { roundHasScorecards } from "./data";

/**
 * Server actions for multi-round scored evaluations (spec.md "Important",
 * decisions.md D-031).
 *
 * Two guard levels live here, and the split matters:
 *  - designing rounds and handing out work is organizer work (`requireAdmin`,
 *    consistent with D-025 keeping binding decisions admin-only);
 *  - filing a scorecard is reviewer work, gated by the reviewer's *own*
 *    assignment row, re-read from the database on every call. A reviewer who
 *    guesses another submission's id gets an error, not a form.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * The same user-facing failure as `fail`, but the underlying error reaches
 * Workers Logs on the way out.
 *
 * These actions used to catch bare (`catch { return fail(...) }`), which made a
 * genuine write failure indistinguishable from a button nobody pressed: a
 * server action that throws still answers 200 at the HTTP layer, so nothing
 * upstream records it either. That cost real time after the 2026-08-18
 * evaluator run, where no scorecard reached the database and the logs had
 * nothing to say about why. Whatever the next failure is, it should be legible.
 */
function failFrom(operation: string, error: unknown, message: string) {
  console.error(`rounds action failed: ${operation}`, error);
  return fail(message);
}

// ---------------------------------------------------------------------------
// Rounds (organizer)
// ---------------------------------------------------------------------------

const criterionInputSchema = z.object({
  id: z.string().trim().optional(),
  label: z.string().trim(),
  type: scorecardCriterionTypeSchema,
  helpText: z.string().trim().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
  weight: z.number().optional(),
});

const roundInputSchema = z.object({
  name: z.string().trim().min(1, "Give the round a name"),
  description: z.string().trim().optional(),
  /** "YYYY-MM-DDTHH:MM" wall-clock in the event's timezone, or "" for none. */
  opensAt: z.string().trim().optional(),
  closesAt: z.string().trim().optional(),
  criteria: z.array(criterionInputSchema),
  /** "Hide speaker identity" (decisions.md D-049) — off unless posted. */
  blindReview: z.boolean().optional(),
});
export type RoundInput = z.infer<typeof roundInputSchema>;

/** Shared parse + normalize: a round is its dates plus a usable scorecard. */
function prepareRound(input: RoundInput, timezone: string) {
  const parsed = roundInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid round");
  const v = parsed.data;

  const criteria = normalizeCriteria(v.criteria);
  if (criteria.length === 0) return fail("Add at least one scorecard criterion");
  const emptyDropdown = criteria.find(
    (criterion) => criterion.type === "select" && (criterion.options ?? []).length === 0,
  );
  if (emptyDropdown) return fail(`Give ${emptyDropdown.label} some dropdown choices`);

  const opensAt = fromZonedInputValue(v.opensAt ?? "", timezone);
  const closesAt = fromZonedInputValue(v.closesAt ?? "", timezone);
  if (opensAt && closesAt && closesAt <= opensAt) {
    return fail("The round has to close after it opens");
  }

  return {
    ok: true as const,
    values: {
      name: v.name,
      description: v.description?.trim() || null,
      opensAt,
      closesAt,
      criteria,
      blindReview: v.blindReview ?? false,
    },
  };
}

export async function createRound(eventSlug: string, input: RoundInput) {
  await requireAdmin(`/admin/${eventSlug}/rounds`);
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("That event no longer exists");

  const prepared = prepareRound(input, event.timezone);
  if (!prepared.ok) return prepared;

  try {
    const round = await repos.reviewRounds.create({ eventId: event.id, ...prepared.values });
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const, roundId: round.id };
  } catch (error) {
    return failFrom("createRound", error, "Couldn't create the round — try again");
  }
}

export async function updateRound(eventSlug: string, roundId: string, input: RoundInput) {
  await requireAdmin(`/admin/${eventSlug}/rounds`);
  const repos = await getRepos();
  const [event, round] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.reviewRounds.getById(roundId),
  ]);
  if (!event || !round || round.eventId !== event.id) return fail("That round no longer exists");

  const prepared = prepareRound(input, event.timezone);
  if (!prepared.ok) return prepared;

  // Once a scorecard is on file the criteria are locked, the way a form's type
  // locks after its first response (D-042): a filed scorecard has to read back
  // exactly as it was entered (D-060), and there is no honest way to do that
  // through questions that have since been deleted, relabelled or rescaled.
  // Everything else about the round stays editable.
  if (
    !criteriaEqual(round.criteria, prepared.values.criteria) &&
    (await roundHasScorecards(repos, roundId))
  ) {
    return fail(
      "Reviewers have already filed scorecards in this round, so its scorecard is locked. Create a new round to score on different criteria.",
    );
  }

  try {
    await repos.reviewRounds.update(roundId, prepared.values);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}`);
    return { ok: true as const, roundId };
  } catch (error) {
    return failFrom("updateRound", error, "Couldn't save the round — try again");
  }
}

export async function deleteRound(eventSlug: string, roundId: string) {
  await requireAdmin(`/admin/${eventSlug}/rounds`);
  const repos = await getRepos();
  const [event, round] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.reviewRounds.getById(roundId),
  ]);
  if (!event || !round || round.eventId !== event.id) return fail("That round no longer exists");

  try {
    // Assignments and their scorecards cascade with the round (src/db/schema.ts).
    await repos.reviewRounds.delete(roundId);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const };
  } catch (error) {
    return failFrom("deleteRound", error, "Couldn't delete the round — try again");
  }
}

// ---------------------------------------------------------------------------
// Assignments (organizer)
// ---------------------------------------------------------------------------

/**
 * What an out-of-track assignment gets rejected with. Named for the fix, since
 * the reviewer's tracks are edited somewhere else entirely (Team).
 */
const OUT_OF_TRACK =
  "A reviewer can only be given submissions their tracks cover — give them the track on Team first, or assign an organizer.";

/** Round + event + a reviewer who is actually allowed to review. */
async function loadAssignmentContext(eventSlug: string, roundId: string, reviewerId: string) {
  const repos = await getRepos();
  const [event, round, reviewer] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.reviewRounds.getById(roundId),
    repos.users.getById(reviewerId),
  ]);
  if (!event || !round || round.eventId !== event.id) return fail("That round no longer exists");
  if (!reviewer || (reviewer.role !== "reviewer" && reviewer.role !== "admin")) {
    return fail("Pick someone with reviewer or organizer access");
  }
  // Routing is the track join (D-061), so the reviewer's tracks on *this* event
  // decide what may be handed to them below. Admins reach everything and need
  // none of it.
  const reviewerTrackIds =
    reviewer.role === "admin"
      ? []
      : (await repos.tracks.listByReviewer(reviewer.id))
          .filter((track) => track.eventId === event.id)
          .map((track) => track.id);

  return { ok: true as const, repos, event, round, reviewer, reviewerTrackIds };
}

/** Submission id -> its track ids, for the eligibility check. */
async function trackIdsBySubmission(
  repos: Repos,
  submissionIds: string[],
): Promise<Map<string, string[]>> {
  const links = await repos.submissions.listTracksBySubmissionIds(submissionIds);
  const map = new Map<string, string[]>();
  for (const link of links) {
    map.set(link.submissionId, [...(map.get(link.submissionId) ?? []), link.trackId]);
  }
  return map;
}

/**
 * Hands specific submissions to one reviewer (ABS-05). Idempotent at the repo
 * layer, so re-running an assignment never wipes work already filed.
 */
export async function assignSubmissions(
  eventSlug: string,
  roundId: string,
  reviewerId: string,
  submissionIds: string[],
) {
  await requireAdmin(`/admin/${eventSlug}/rounds`);
  const context = await loadAssignmentContext(eventSlug, roundId, reviewerId);
  if (!context.ok) return context;
  const { repos, event, reviewer, reviewerTrackIds } = context;

  const wanted = new Set(submissionIds);
  if (wanted.size === 0) return fail("Choose at least one submission");

  // Only submissions on this event may be assigned — the ids arrive from a
  // form and are never trusted on their own.
  const [submissions, directFormIds] = await Promise.all([
    repos.submissions.listByEvent(event.id),
    directSessionFormIds(repos, event.id),
  ]);
  const allowed = submissions.filter(
    // Session-type submissions are never review work (decisions.md D-041).
    (submission) => wanted.has(submission.id) && !directFormIds.has(submission.formId),
  );
  if (allowed.length === 0) return fail("Those submissions aren't part of this event");

  // The assignment is the authorization to score (D-035), so it may never grant
  // work the reviewer can't otherwise reach (D-060/D-061). The picker already
  // hides these; this is the control.
  const trackIds = await trackIdsBySubmission(
    repos,
    allowed.map((submission) => submission.id),
  );
  const unreachable = allowed.filter(
    (submission) =>
      !canAssignReviewer(reviewer.role, reviewerTrackIds, trackIds.get(submission.id) ?? []),
  );
  if (unreachable.length > 0) return fail(OUT_OF_TRACK);

  try {
    for (const submission of allowed) {
      await repos.reviewRounds.assign(roundId, submission.id, reviewerId);
    }
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/results`);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const, assigned: allowed.length };
  } catch (error) {
    return failFrom("assignSubmissions", error, "Couldn't assign those submissions — try again");
  }
}

/**
 * The at-scale affordance (ABS-06): every submission in a track — or the whole
 * event when `trackId` is empty — to one reviewer in a single action.
 */
export async function assignTrack(
  eventSlug: string,
  roundId: string,
  reviewerId: string,
  trackId: string,
) {
  await requireAdmin(`/admin/${eventSlug}/rounds`);
  const context = await loadAssignmentContext(eventSlug, roundId, reviewerId);
  if (!context.ok) return context;
  const { repos, event, reviewer, reviewerTrackIds } = context;

  const [all, directFormIds] = await Promise.all([
    repos.submissions.listByEvent(event.id),
    directSessionFormIds(repos, event.id),
  ]);
  const submissions = all.filter(
    (submission) =>
      submission.status !== "draft" &&
      submission.status !== "withdrawn" &&
      // Sessions on arrival were never reviewable (decisions.md D-041).
      !directFormIds.has(submission.formId),
  );
  // Only read the track join when something actually consults it: an admin
  // assigning "every submission" is answered without it.
  const trackIds =
    trackId || reviewer.role !== "admin"
      ? await trackIdsBySubmission(
          repos,
          submissions.map((submission) => submission.id),
        )
      : new Map<string, string[]>();
  let targets = submissions;
  if (trackId) {
    targets = submissions.filter((submission) =>
      (trackIds.get(submission.id) ?? []).includes(trackId),
    );
  }
  if (targets.length === 0) return fail("Nothing to assign — that track has no submissions yet");

  // "Everything" means everything this reviewer can actually reach: a bulk
  // assignment must not hand out work their tracks don't cover (D-061).
  const reachable = targets.filter((submission) =>
    canAssignReviewer(reviewer.role, reviewerTrackIds, trackIds.get(submission.id) ?? []),
  );
  if (reachable.length === 0) return fail(OUT_OF_TRACK);
  targets = reachable;

  try {
    for (const submission of targets) {
      await repos.reviewRounds.assign(roundId, submission.id, reviewerId);
    }
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/results`);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const, assigned: targets.length };
  } catch (error) {
    return failFrom("assignTrack", error, "Couldn't assign that track — try again");
  }
}

export async function unassignSubmission(
  eventSlug: string,
  roundId: string,
  assignmentId: string,
) {
  await requireAdmin(`/admin/${eventSlug}/rounds`);
  const repos = await getRepos();
  const [event, round, assignment] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.reviewRounds.getById(roundId),
    repos.reviewRounds.getAssignment(assignmentId),
  ]);
  if (!event || !round || round.eventId !== event.id) return fail("That round no longer exists");
  if (!assignment || assignment.roundId !== roundId) return fail("That assignment is already gone");

  try {
    await repos.reviewRounds.unassign(assignmentId);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/results`);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const };
  } catch (error) {
    return failFrom("unassign", error, "Couldn't remove that assignment — try again");
  }
}

// ---------------------------------------------------------------------------
// Scoring (reviewer)
// ---------------------------------------------------------------------------

/**
 * Re-checks, from the session and the database, that this caller holds an
 * assignment for this submission in this round. Every reviewer-side action goes
 * through here; the UI hiding a link is never the control.
 */
async function requireOwnAssignment(eventSlug: string, roundId: string, submissionId: string) {
  const viewer = await requireAdminOrReviewer(`/admin/${eventSlug}/rounds`);
  const repos = await getRepos();
  const [event, round] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.reviewRounds.getById(roundId),
  ]);
  if (!event || !round || round.eventId !== event.id) return fail("That round no longer exists");

  const mine = await repos.reviewRounds.listAssignmentsByReviewer(viewer.id);
  if (!canScoreSubmission(mine, roundId, viewer.id, submissionId)) {
    return fail("That submission isn't assigned to you in this round");
  }
  const assignment = mine.find(
    (row) => row.roundId === roundId && row.submissionId === submissionId,
  );
  if (!assignment) return fail("That submission isn't assigned to you in this round");

  return { ok: true as const, repos, event, round, assignment, viewer };
}

/** Files (or revises) this reviewer's scorecard — ABS-03. */
export async function submitScorecard(
  eventSlug: string,
  roundId: string,
  submissionId: string,
  values: Record<string, unknown>,
) {
  const context = await requireOwnAssignment(eventSlug, roundId, submissionId);
  if (!context.ok) return context;
  const { repos, round, assignment } = context;

  if (!isRoundOpen(round)) {
    return fail("This round isn't open for scoring — check its dates with the organizer");
  }

  const clean = pickScorecardValues(round.criteria, values);
  const problem = validateScorecard(round.criteria, clean);
  if (problem) return fail(problem);

  try {
    await repos.reviewRounds.saveScore(assignment.id, clean, new Date());
    // A reviewer who scores after recusing is back on the hook for it.
    await repos.reviewRounds.setAssignmentStatus(assignment.id, "done", null);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/score`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/score/${submissionId}`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/results`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const };
  } catch (error) {
    return failFrom("submitScorecard", error, "Couldn't save your scorecard — try again");
  }
}

/**
 * Conflict of interest (ABS-12): the item leaves the reviewer's required work
 * and the reason shows up on the organizer's progress view.
 */
export async function recuseFromSubmission(
  eventSlug: string,
  roundId: string,
  submissionId: string,
  reason: string,
) {
  const context = await requireOwnAssignment(eventSlug, roundId, submissionId);
  if (!context.ok) return context;
  const { repos, assignment } = context;

  try {
    await repos.reviewRounds.setAssignmentStatus(assignment.id, "recused", reason.trim() || null);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/score`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/score/${submissionId}`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
    revalidatePath(`/admin/${eventSlug}/rounds/${roundId}/results`);
    revalidatePath(`/admin/${eventSlug}/rounds`);
    return { ok: true as const };
  } catch (error) {
    return failFrom("recuseFromSubmission", error, "Couldn't record that conflict — try again");
  }
}
