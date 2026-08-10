/**
 * Review & decision domain service (spec.md §4, §5).
 *
 * Three jobs live here:
 *
 * 1. **Routing** — who is allowed to see and vote on a submission. Routing is
 *    the track join and nothing else (spec.md §4: "reviewers own tracks,
 *    submissions pick tracks. No routing engine").
 * 2. **The decision state machine** — what an accept / waitlist / decline does
 *    to a submission, and what else has to happen as a consequence. Status
 *    transitions belong exclusively to this flow (decisions.md D-022: a
 *    submitter's edit never touches status).
 * 3. **Acceptance conversion** — accepting a talk creates the session and the
 *    onboarding tasks with no manual re-entry (spec.md §5).
 *
 * Everything above the `recordDecision` orchestrator is pure TypeScript with
 * colocated unit tests (review.test.ts). The orchestrator is the only part
 * that touches storage, and it does so through the storage-agnostic `Repos`
 * bundle — same shape as src/domain/submissions.ts and src/domain/comms.ts.
 */
import type {
  NewSession,
  NewTaskAssignment,
  Review,
  ReviewRecommendation,
  Role,
  Session,
  Submission,
  SubmissionDecision,
  SubmissionStatus,
  Task,
  TaskAssignment,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import { decide, summarizeReviews, type DecisionPatch } from "@/domain/evaluation";
import { sendDecisionEmail, type CommsContext, type CommsDelivery } from "@/domain/comms";

export { canDecide } from "@/domain/evaluation";
export type { DecisionPatch } from "@/domain/evaluation";

// ---------------------------------------------------------------------------
// Tally (spec.md §4 — "minimum flow: unreviewed -> approve / maybe / deny")
// ---------------------------------------------------------------------------

export interface ReviewTally {
  /** Reviews recorded, including comment-only ones with no recommendation. */
  total: number;
  approve: number;
  maybe: number;
  deny: number;
  /** How many of `total` actually carry a recommendation. */
  voted: number;
  /** Null unless a reviewer used the optional score field (enhancement tier). */
  averageScore: number | null;
  /**
   * The recommendation with the most votes, or null when nothing has been
   * voted yet **or** the leaders are tied. A tie deliberately reads as "no
   * leaning" rather than picking a winner by enum order — an organizer
   * shouldn't be told the committee leans a way it doesn't.
   */
  leaning: ReviewRecommendation | null;
}

const EMPTY_TALLY: ReviewTally = {
  total: 0,
  approve: 0,
  maybe: 0,
  deny: 0,
  voted: 0,
  averageScore: null,
  leaning: null,
};

/** Counts a submission's reviewer votes — the number every review view shows. */
export function tallyReviews(reviews: Review[]): ReviewTally {
  if (reviews.length === 0) return { ...EMPTY_TALLY };

  const { recommendations, averageScore } = summarizeReviews("", reviews);
  const voted = recommendations.approve + recommendations.maybe + recommendations.deny;

  const ranked = (["approve", "maybe", "deny"] as const)
    .map((key) => ({ key, count: recommendations[key] }))
    .sort((a, b) => b.count - a.count);
  const leaning =
    ranked[0].count === 0 || ranked[0].count === ranked[1].count ? null : ranked[0].key;

  return {
    total: reviews.length,
    approve: recommendations.approve,
    maybe: recommendations.maybe,
    deny: recommendations.deny,
    voted,
    averageScore,
    leaning,
  };
}

/** Tallies for a whole list in one pass — the submissions table's review column. */
export function tallyReviewsBySubmission(reviews: Review[]): Record<string, ReviewTally> {
  const grouped = new Map<string, Review[]>();
  for (const review of reviews) {
    grouped.set(review.submissionId, [...(grouped.get(review.submissionId) ?? []), review]);
  }
  return Object.fromEntries([...grouped].map(([id, rows]) => [id, tallyReviews(rows)]));
}

// ---------------------------------------------------------------------------
// Routing (spec.md §4 — track-based responsibility)
// ---------------------------------------------------------------------------

/**
 * True when any of the submission's tracks is one the reviewer owns.
 *
 * A submission with no tracks reaches no reviewer: there is nobody it routes
 * to, so it stays an admin's problem rather than silently landing in
 * everyone's queue.
 */
export function isRoutedToReviewer(
  reviewerTrackIds: string[],
  submissionTrackIds: string[],
): boolean {
  if (reviewerTrackIds.length === 0 || submissionTrackIds.length === 0) return false;
  const owned = new Set(reviewerTrackIds);
  return submissionTrackIds.some((trackId) => owned.has(trackId));
}

/** Admins see the whole event; reviewers see their tracks (spec.md "Users"). */
export function canViewSubmission(
  role: Role,
  reviewerTrackIds: string[],
  submissionTrackIds: string[],
): boolean {
  if (role === "admin") return true;
  if (role !== "reviewer") return false;
  return isRoutedToReviewer(reviewerTrackIds, submissionTrackIds);
}

/**
 * Whether this reviewer may be *handed* this submission as round work.
 *
 * Deliberately the same question as reading it (`canViewSubmission`, D-061):
 * an assignment outside the reviewer's tracks is work they cannot open from the
 * submission record — the scoring entry point (D-060) — and cannot find on the
 * submissions list, so it was never a legitimate assignment. Admins review
 * anything; a submission with no tracks routes to nobody, so only an admin can
 * be given one.
 */
export function canAssignReviewer(
  role: Role,
  reviewerTrackIds: string[],
  submissionTrackIds: string[],
): boolean {
  return canViewSubmission(role, reviewerTrackIds, submissionTrackIds);
}

/** The reviewers one submission may be offered to — the assignment picker's pool. */
export function eligibleReviewers<T extends { id: string; role: Role }>(
  pool: T[],
  trackIdsByReviewer: ReadonlyMap<string, string[]>,
  submissionTrackIds: string[],
): T[] {
  return pool.filter((person) =>
    canAssignReviewer(person.role, trackIdsByReviewer.get(person.id) ?? [], submissionTrackIds),
  );
}

/**
 * Narrows a list to what this viewer is allowed to see.
 *
 * A `draft` is a proposal its author hasn't sent yet (decisions.md D-034, D-038):
 * it never reaches a reviewer, whatever tracks it names, because reviewing
 * something nobody submitted is both unfair and confusing. Admins still see
 * drafts — they run the call, and an unfinished proposal on a closing form is
 * something they may want to chase.
 *
 * A submission to a **session-type form** is kept off a reviewer's queue for
 * the mirror-image reason (D-041): it was accepted the moment it arrived, so
 * there is no decision left for the committee to influence. Admins still see
 * it, badged, because it's part of their programme.
 */
export function visibleSubmissions<
  T extends { id: string; formId: string; status: SubmissionStatus },
>(
  submissions: T[],
  trackIdsBySubmission: Record<string, string[]>,
  role: Role,
  reviewerTrackIds: string[],
  options: { directSessionFormIds?: ReadonlySet<string> } = {},
): T[] {
  if (role === "admin") return submissions;
  const direct = options.directSessionFormIds;
  return submissions.filter(
    (submission) =>
      submission.status !== "draft" &&
      !direct?.has(submission.formId) &&
      canViewSubmission(role, reviewerTrackIds, trackIdsBySubmission[submission.id] ?? []),
  );
}

// ---------------------------------------------------------------------------
// Which list a reviewer lands on (decisions.md D-066)
// ---------------------------------------------------------------------------

/**
 * The two lists the submissions queue can show a reviewer: the talks they hold
 * an active round assignment on, or every talk their tracks route to them.
 */
export type QueueView = "assigned" | "all";

export const QUEUE_VIEW_ASSIGNED: QueueView = "assigned";
export const QUEUE_VIEW_ALL: QueueView = "all";

/**
 * Which list to render, from the URL's `view` and how much assigned work the
 * viewer actually has (decisions.md D-066).
 *
 * A reviewer holding assignments lands on them — "what's mine to do" is the
 * first question they have — and anything else falls through to the
 * track-scoped list D-047 describes: an explicit `?view=all`, a viewer with no
 * active assignment, and an admin (who never has an assigned view here).
 *
 * Presentation only. `visibleSubmissions` above still decides what may be
 * listed at all, and `canViewSubmission` still decides what may be opened —
 * neither reads this (D-061).
 */
export function resolveQueueView(
  requested: string | undefined | null,
  assignedCount: number,
): QueueView {
  if (assignedCount <= 0) return QUEUE_VIEW_ALL;
  return requested === QUEUE_VIEW_ALL ? QUEUE_VIEW_ALL : QUEUE_VIEW_ASSIGNED;
}

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/**
 * Reviewers vote; only an admin records the binding decision.
 *
 * spec.md §4's minimum flow says a decision is "decidable by reviewer or
 * admin", but accepting is no longer only a status change here — it creates
 * the session and hands the speaker their onboarding tasks (spec.md §5) and
 * sends them a promise in writing. That is a programme-owner action, so the
 * reviewer's approve/maybe/deny lives on their `reviews` row as the non-binding
 * recommendation the schema already describes it as.
 */
export function canRecordDecision(role: Role): boolean {
  return role === "admin";
}

/** Reviewers and admins both vote — an admin's own read counts too. */
export function canRecordReview(role: Role): boolean {
  return role === "admin" || role === "reviewer";
}

// ---------------------------------------------------------------------------
// Decision state machine
// ---------------------------------------------------------------------------

export interface DecisionOption {
  value: SubmissionDecision;
  /** Verb on the button. */
  label: string;
  /** What the organizer is about to set in motion. */
  description: string;
}

/** The three outcomes, in the order the decision panel offers them. */
export const DECISION_OPTIONS: DecisionOption[] = [
  {
    value: "approved",
    label: "Accept",
    description:
      "Creates the session and the speaker's onboarding tasks, and emails everyone on the talk.",
  },
  {
    value: "maybe",
    label: "Waitlist",
    description:
      "Keeps the talk in play without promising a slot. Internal only: speakers keep seeing the proposal as in review.",
  },
  {
    value: "denied",
    label: "Decline",
    description: "Emails the speakers a decline. No session or tasks are created.",
  },
];

export interface DecisionPlan {
  patch: DecisionPatch;
  /** Accepting is the trigger into onboarding (spec.md §5). */
  convert: boolean;
  /**
   * True when a talk that had already been accepted is now waitlisted or
   * declined: the session made from it has to be stood down. It is cancelled
   * rather than deleted so the change is visible instead of silent, and so a
   * re-accept can restore the same agenda item.
   */
  cancelSession: boolean;
  /** Whether the speakers get the accept/waitlist/decline notice. */
  notify: boolean;
}

/**
 * Works out everything a decision implies, without performing any of it.
 *
 * Re-deciding is allowed on purpose — organizers change their minds, and the
 * plan describes the consequences of the *change* (an accept that is later
 * declined has to take the session back down).
 */
export function planDecision(
  submission: Submission,
  decision: SubmissionDecision,
  decidedBy: string | null,
  options: { note?: string | null; notify?: boolean; now?: Date } = {},
): DecisionPlan {
  const patch = decide(submission, decision, decidedBy, {
    note: options.note,
    now: options.now,
  });
  return {
    patch,
    convert: decision === "approved",
    cancelSession: submission.status === "approved" && decision !== "approved",
    notify: options.notify ?? true,
  };
}

// ---------------------------------------------------------------------------
// Acceptance conversion (spec.md §5)
// ---------------------------------------------------------------------------

export interface ConversionInputs {
  submission: Submission;
  /** The submission's tracks; the first one becomes the session's track. */
  trackIds: string[];
  /** Everyone on the talk, primary speaker first. */
  speakerIds: string[];
  /** The session this submission was already converted into, if any. */
  existingSession: Session | null;
  /** `tasks.autoAssignOnAccept` rows for the event. */
  autoAssignTasks: Task[];
  /** Assignments those speakers already hold, so re-accepting adds nothing twice. */
  existingAssignments: TaskAssignment[];
}

export interface ConversionPlan {
  /** The session to create, or null when one already exists. */
  createSession: NewSession | null;
  /** Repairs to an existing session (e.g. un-cancelling a re-accepted talk). */
  sessionUpdate: { id: string; patch: Partial<NewSession> } | null;
  /** The session's full desired speaker set. */
  speakerIds: string[];
  /** Only the (task, speaker) pairs that don't exist yet. */
  newAssignments: NewTaskAssignment[];
}

/**
 * Turns an accepted submission into the records spec.md §5 promises: a session
 * and the standard onboarding tasks for every speaker on it.
 *
 * The session is created **unscheduled** — no day, time, or room. Placement is
 * the agenda board's job (spec.md §9), and guessing a slot here would put talks
 * on the schedule that nobody chose to programme.
 *
 * Idempotent: run it twice and the second run plans nothing, because an
 * accepted talk that is accepted again (a note edit, a double-click) must not
 * grow a second session or a second copy of every task.
 *
 * The speaker *users* need no creating here — every name on a submission is
 * already a `users` row with the speaker role, created when the proposal was
 * saved (src/domain/submissions.ts). An admin or reviewer who also speaks keeps
 * their role: the session link is what makes someone a speaker at this event,
 * not the role column, and demoting them would cost them the admin area.
 */
export function planAcceptanceConversion(input: ConversionInputs): ConversionPlan {
  const { submission, existingSession } = input;

  const createSession: NewSession | null = existingSession
    ? null
    : {
        eventId: submission.eventId,
        title: submission.title,
        description: submission.description,
        submissionId: submission.id,
        trackId: input.trackIds[0] ?? null,
        roomId: null,
        day: null,
        startTime: null,
        endTime: null,
        status: "confirmed",
        // The organizer accepted this abstract as written, so its content is
        // approved on arrival (decisions.md D-072) — accepting a talk must
        // not leave it invisible to the public program it was accepted for.
        contentStatus: "approved",
      };

  // Only ever repair status. Title/description are left alone: once a session
  // exists the organizer may have retitled it for the programme, and an accept
  // re-run must not overwrite that with the original proposal text.
  const sessionUpdate =
    existingSession && existingSession.status !== "confirmed"
      ? { id: existingSession.id, patch: { status: "confirmed" as const } }
      : null;

  const held = new Set(
    input.existingAssignments.map((assignment) => `${assignment.taskId}:${assignment.speakerId}`),
  );
  const newAssignments: NewTaskAssignment[] = [];
  for (const task of input.autoAssignTasks) {
    for (const speakerId of input.speakerIds) {
      if (held.has(`${task.id}:${speakerId}`)) continue;
      newAssignments.push({
        taskId: task.id,
        speakerId,
        status: "pending",
        completedAt: null,
        responseJson: null,
        fileUrl: null,
      });
    }
  }

  return { createSession, sessionUpdate, speakerIds: input.speakerIds, newAssignments };
}

// ---------------------------------------------------------------------------
// Reversing an acceptance
// ---------------------------------------------------------------------------

export interface ReversalCleanupInputs {
  /** The event the reversal happened on — sessions elsewhere are not its business. */
  eventId: string;
  /** The session just stood down, which never counts as work still on. */
  cancelledSessionId: string | null;
  /** Everyone on the submission being reversed. */
  speakerIds: string[];
  /** `tasks.autoAssignOnAccept` rows for the event — the only ones acceptance created. */
  autoAssignTasks: Array<Pick<Task, "id">>;
  /** Every task assignment those speakers hold. */
  assignments: TaskAssignment[];
  /** Every session each speaker is on, keyed by speaker id. */
  sessionsBySpeaker: Record<string, Array<Pick<Session, "id" | "eventId" | "status">>>;
}

/**
 * The task assignments to delete when an acceptance is reversed: the onboarding
 * work the original accept auto-created, and nothing else.
 *
 * Four things keep it narrow. Only **auto-assigned** tasks go — anything an
 * organizer handed this person by hand is their decision, not a side effect of
 * the accept. Only **incomplete** ones go: a speaker who already uploaded their
 * headshot did that work, and destroying the record of it would be worse than
 * an orphaned row. Only speakers **left with no other live session** at this
 * event are cleared, because a second accepted talk keeps their onboarding
 * genuinely owed. And only this event's sessions count — a talk at next year's
 * conference says nothing about this one.
 */
export function planReversalCleanup(input: ReversalCleanupInputs): string[] {
  const speakers = new Set(input.speakerIds);
  const auto = new Set(input.autoAssignTasks.map((task) => task.id));

  const stillSpeaking = new Set(
    input.speakerIds.filter((speakerId) =>
      (input.sessionsBySpeaker[speakerId] ?? []).some(
        (session) =>
          session.eventId === input.eventId &&
          session.id !== input.cancelledSessionId &&
          session.status !== "cancelled",
      ),
    ),
  );

  return input.assignments
    .filter(
      (assignment) =>
        speakers.has(assignment.speakerId) &&
        !stillSpeaking.has(assignment.speakerId) &&
        auto.has(assignment.taskId) &&
        assignment.status !== "completed",
    )
    .map((assignment) => assignment.id);
}

// ---------------------------------------------------------------------------
// Orchestration (the only storage-touching part)
// ---------------------------------------------------------------------------

export interface ReviewContext {
  repos: Repos;
  /**
   * Set to send the accept/waitlist/decline email (spec.md §7 — no stubs).
   * Left unset only where there is no transport, e.g. a unit fixture.
   */
  comms?: CommsContext;
}

export interface RecordDecisionInput {
  submissionId: string;
  decision: SubmissionDecision;
  /** The admin recording it, or null when the form decided (D-041). */
  decidedBy: string | null;
  note?: string | null;
  /** Default true; false records the decision silently. */
  notify?: boolean;
  now?: Date;
}

export interface RecordDecisionResult {
  submission: Submission;
  /** The session the talk was converted into (created now or previously). */
  sessionId: string | null;
  sessionCreated: boolean;
  assignmentsCreated: number;
  /** Onboarding assignments withdrawn because an acceptance was reversed. */
  assignmentsRemoved: number;
  /** One entry per speaker emailed; empty when `notify` was false. */
  deliveries: CommsDelivery[];
}

/**
 * Records a decision and everything it implies: the status transition, the
 * acceptance conversion, and the speaker-facing email.
 *
 * D1 gives the repository layer no cross-table transaction, so the ordering
 * carries the safety instead: the conversion runs before the email, so the
 * accept notice can quote the session and the tasks it just created and the
 * speaker is never told about work that failed to appear. Each step is
 * individually idempotent, so a retry after a partial failure converges.
 */
export async function recordDecision(
  ctx: ReviewContext,
  input: RecordDecisionInput,
): Promise<RecordDecisionResult> {
  const { repos } = ctx;
  const current = await repos.submissions.getById(input.submissionId);
  if (!current) throw new Error(`Submission ${input.submissionId} not found`);

  const plan = planDecision(current, input.decision, input.decidedBy, {
    note: input.note,
    notify: input.notify,
    now: input.now,
  });

  const submission = await repos.submissions.update(current.id, plan.patch);

  let sessionId: string | null = null;
  let sessionCreated = false;
  let assignmentsCreated = 0;
  let assignmentsRemoved = 0;

  if (plan.convert) {
    const [trackIds, speakerLinks, existingSession, tasks] = await Promise.all([
      repos.submissions.listTrackIds(submission.id),
      repos.submissions.listSpeakers(submission.id),
      repos.sessions.getBySubmission(submission.id),
      repos.tasks.listAutoAssignByEvent(submission.eventId),
    ]);

    // Primary speaker first, so they lead the session's speaker list.
    const speakerIds = [...speakerLinks]
      .sort((a, b) => (a.role === "primary" ? -1 : b.role === "primary" ? 1 : 0))
      .map((link) => link.userId);

    const existingAssignments = (
      await Promise.all(speakerIds.map((id) => repos.taskAssignments.listBySpeaker(id)))
    ).flat();

    const conversion = planAcceptanceConversion({
      submission,
      trackIds,
      speakerIds,
      existingSession,
      autoAssignTasks: tasks,
      existingAssignments,
    });

    if (conversion.createSession) {
      const session = await repos.sessions.create(conversion.createSession);
      sessionId = session.id;
      sessionCreated = true;
    } else {
      sessionId = existingSession?.id ?? null;
      if (conversion.sessionUpdate) {
        await repos.sessions.update(conversion.sessionUpdate.id, conversion.sessionUpdate.patch);
      }
    }

    if (sessionId && conversion.speakerIds.length > 0) {
      await repos.sessions.setSpeakers(sessionId, conversion.speakerIds);
    }
    for (const assignment of conversion.newAssignments) {
      await repos.taskAssignments.create(assignment);
      assignmentsCreated += 1;
    }
  } else {
    const existingSession = await repos.sessions.getBySubmission(submission.id);
    sessionId = existingSession?.id ?? null;
    if (plan.cancelSession) {
      if (existingSession && existingSession.status !== "cancelled") {
        await repos.sessions.update(existingSession.id, { status: "cancelled" });
      }
      // Standing the session down is only half of it: the onboarding tasks the
      // accept created stay actionable — and keep the speaker in digest
      // recipient sets — until they're withdrawn too.
      assignmentsRemoved = await withdrawOnboarding(repos, submission, sessionId);
    }
  }

  let deliveries: CommsDelivery[] = [];
  if (plan.notify && ctx.comms) {
    deliveries = await sendDecisionEmail(ctx.comms, {
      submissionId: submission.id,
      decision: input.decision,
      note: plan.patch.decisionNote,
    });
  }

  return {
    submission,
    sessionId,
    sessionCreated,
    assignmentsCreated,
    assignmentsRemoved,
    deliveries,
  };
}

/**
 * Takes back the onboarding work a now-reversed acceptance handed out, and
 * reports how much it removed. The rule lives in `planReversalCleanup`; this
 * only fetches what that needs and applies the answer.
 */
async function withdrawOnboarding(
  repos: Repos,
  submission: Submission,
  cancelledSessionId: string | null,
): Promise<number> {
  const [speakerLinks, autoAssignTasks] = await Promise.all([
    repos.submissions.listSpeakers(submission.id),
    repos.tasks.listAutoAssignByEvent(submission.eventId),
  ]);
  const speakerIds = [...new Set(speakerLinks.map((link) => link.userId))];
  if (speakerIds.length === 0 || autoAssignTasks.length === 0) return 0;

  const perSpeaker = await Promise.all(
    speakerIds.map(async (speakerId) => ({
      speakerId,
      assignments: await repos.taskAssignments.listBySpeaker(speakerId),
      sessions: await repos.sessions.listBySpeaker(speakerId),
    })),
  );

  const doomed = planReversalCleanup({
    eventId: submission.eventId,
    cancelledSessionId,
    speakerIds,
    autoAssignTasks,
    assignments: perSpeaker.flatMap((entry) => entry.assignments),
    sessionsBySpeaker: Object.fromEntries(
      perSpeaker.map((entry) => [entry.speakerId, entry.sessions]),
    ),
  });

  for (const assignmentId of doomed) {
    await repos.taskAssignments.delete(assignmentId);
  }
  return doomed.length;
}

/**
 * Accepts a submission the instant it arrives, because its form creates
 * sessions directly rather than collecting proposals for review
 * (decisions.md D-041).
 *
 * Deliberately a thin call into `recordDecision` rather than its own
 * conversion: a session-type submission has to land *exactly* like an accepted
 * abstract — same status transition, same session (confirmed, unscheduled),
 * same speaker links, same auto-assigned onboarding tasks — and the only way
 * to guarantee that stays true is for there to be one implementation.
 *
 * Two arguments carry the difference:
 *  - `decidedBy: null` — nobody decided this; the form did. That is how an
 *    automatic acceptance is recorded (see `decide` in
 *    src/domain/evaluation.ts): a `decidedAt` with no decider.
 *  - `notify: false` — the speaker already gets this form's own confirmation
 *    email on submit (spec.md §2). A second "your talk was accepted" mail for
 *    a slot that was agreed before the form was ever sent would be noise.
 */
export async function acceptOnArrival(
  ctx: ReviewContext,
  input: { submissionId: string; now?: Date },
): Promise<RecordDecisionResult> {
  return recordDecision(ctx, {
    submissionId: input.submissionId,
    decision: "approved",
    decidedBy: null,
    notify: false,
    now: input.now,
  });
}

// ---------------------------------------------------------------------------
// Reviewer votes
// ---------------------------------------------------------------------------

export interface SaveReviewInput {
  submissionId: string;
  reviewerId: string;
  recommendation: ReviewRecommendation | null;
  comment?: string | null;
  score?: number | null;
}

/**
 * Records (or replaces) one reviewer's vote. One row per reviewer per
 * submission — the schema's unique constraint — so voting again is an edit,
 * not a second opinion.
 */
export async function saveReview(ctx: ReviewContext, input: SaveReviewInput): Promise<Review> {
  const existing = await ctx.repos.reviews.getByReviewer(input.submissionId, input.reviewerId);
  const values = {
    submissionId: input.submissionId,
    reviewerId: input.reviewerId,
    recommendation: input.recommendation,
    comment: input.comment?.trim() || null,
    score: input.score ?? existing?.score ?? null,
  };
  return existing
    ? ctx.repos.reviews.update(existing.id, values)
    : ctx.repos.reviews.create(values);
}
