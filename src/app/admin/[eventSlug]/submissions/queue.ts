import {
  createsSessionsDirectly,
  type Event,
  type ReviewRound,
  type RoundAssignment,
  type Submission,
  type Track,
  type User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import { tallyReviewsBySubmission, visibleSubmissions, type ReviewTally } from "@/domain/review";
import {
  isRoundOpen,
  rollupRoundsBySubmission,
  scorecardAnswers,
  type ScorecardAnswer,
  type SubmissionReviewRollup,
  type SubmissionRoundRollup,
} from "@/domain/rounds";
import type { SessionUser } from "@/lib/session";
import { ALL, type QueueFilter } from "./filters";

/**
 * Reads for the admin review queue (spec.md §4).
 *
 * Kept beside the pages that use it rather than in src/domain: it is pure
 * assembly of repo reads for one screen, with the actual rules (routing,
 * tallies) imported from src/domain/review.ts.
 */

export interface QueueRow {
  submission: Submission;
  trackIds: string[];
  trackNames: string[];
  speakers: Array<Pick<User, "id" | "name" | "email">>;
  tally: ReviewTally;
  /** Filed round scorecards for this submission (decisions.md D-048); empty
   * for a reviewer, who never sees another reviewer's round work (D-035). */
  rollup: SubmissionReviewRollup;
}

export interface SubmissionQueue {
  rows: QueueRow[];
  /** Every track on the event — the filter's options, not just used ones. */
  tracks: Track[];
  /** The reviewer's own tracks; empty for an admin (who sees everything). */
  reviewerTrackIds: string[];
  /** Forms whose submissions became sessions on arrival (decisions.md D-041) —
   * what the admin table badges "Direct to session". */
  directSessionFormIds: Set<string>;
}

/**
 * The event's session-type forms (decisions.md D-041). One read, shared by
 * every screen that has to tell review work apart from a proposal that was
 * never review work in the first place.
 */
export async function directSessionFormIds(repos: Repos, eventId: string): Promise<Set<string>> {
  const forms = await repos.forms.listByEvent(eventId);
  return new Set(forms.filter(createsSessionsDirectly).map((form) => form.id));
}

/** One scorecard as the organizer reads it on the submission record (D-048). */
export interface FiledScorecard {
  reviewerName: string;
  submittedAt: Date;
  /** Label/value lines, ratings raw on their own scale (src/domain/rounds.ts). */
  answers: ScorecardAnswer[];
}

/** A round's standing on one submission, with the scorecards behind it. */
export interface SubmissionRoundDetail extends SubmissionRoundRollup {
  filed: FiledScorecard[];
}

export interface SubmissionRollup extends SubmissionReviewRollup {
  rounds: SubmissionRoundDetail[];
}

/** No round holds this submission — the shape every caller falls back to. */
const NO_ROUNDS: SubmissionRollup = { rounds: [], scorecards: 0 };

/**
 * Where every submission on the event stands in its review rounds, keyed by
 * submission id (decisions.md D-048). Four batched reads for the whole event,
 * so the submissions table and the detail page can tell the truth about round
 * activity without a query per row.
 *
 * The aggregate alone was never enough to read a round back: an organizer
 * needs the answers themselves — including the dropdown and free-text criteria
 * no aggregate can carry (D-035) — so each filed scorecard comes with its
 * reviewer, when it landed, and every answer on it.
 *
 * Organizer-only by contract: a round's scores are admin material (D-035), so
 * callers pass the rollup only to an admin's screen.
 */
export async function loadRoundRollups(
  repos: Repos,
  eventId: string,
): Promise<Record<string, SubmissionRollup>> {
  const rounds = await repos.reviewRounds.listByEvent(eventId);
  if (rounds.length === 0) return {};
  const assignments = await repos.reviewRounds.listAssignmentsByRounds(
    rounds.map((round) => round.id),
  );
  const scores = await repos.reviewRounds.listScoresByAssignments(
    assignments.map((assignment) => assignment.id),
  );
  const base = rollupRoundsBySubmission(rounds, assignments, scores);

  const scoreByAssignment = new Map(scores.map((score) => [score.assignmentId, score]));
  const filedWork = assignments.filter((assignment) => scoreByAssignment.has(assignment.id));
  // Only the people who actually filed something are looked up.
  const reviewers = await repos.users.listByIds([
    ...new Set(filedWork.map((assignment) => assignment.reviewerId)),
  ]);
  const reviewerById = new Map(reviewers.map((person) => [person.id, person]));
  const criteriaByRound = new Map(rounds.map((round) => [round.id, round.criteria]));

  const filedBySubmissionRound = new Map<string, FiledScorecard[]>();
  for (const assignment of filedWork) {
    const score = scoreByAssignment.get(assignment.id)!;
    const reviewer = reviewerById.get(assignment.reviewerId);
    const key = `${assignment.submissionId}:${assignment.roundId}`;
    filedBySubmissionRound.set(key, [
      ...(filedBySubmissionRound.get(key) ?? []),
      {
        reviewerName: reviewer ? personName(reviewer) : "A reviewer",
        submittedAt: score.submittedAt,
        answers: scorecardAnswers(criteriaByRound.get(assignment.roundId) ?? [], score.values),
      },
    ]);
  }

  const rollups: Record<string, SubmissionRollup> = {};
  for (const [submissionId, rollup] of Object.entries(base)) {
    rollups[submissionId] = {
      scorecards: rollup.scorecards,
      rounds: rollup.rounds.map((round) => ({
        ...round,
        filed: [...(filedBySubmissionRound.get(`${submissionId}:${round.roundId}`) ?? [])].sort(
          (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
        ),
      })),
    };
  }
  return rollups;
}

/** The round standing for one submission, or the empty rollup. */
export function rollupFor(
  rollups: Record<string, SubmissionRollup>,
  submissionId: string,
): SubmissionRollup {
  return rollups[submissionId] ?? NO_ROUNDS;
}

/** One round this viewer owes a scorecard on, for one submission. */
export interface ViewerScorecard {
  round: ReviewRound;
  assignment: RoundAssignment;
  /** This viewer's own answers; `{}` until they file. Never anyone else's. */
  values: Record<string, unknown>;
  submitted: boolean;
  /** Whether the round's window is open right now — the form reads either way. */
  open: boolean;
}

/**
 * The round scorecards this viewer is personally on the hook for on one
 * submission, so the record can offer them where the proposal is (D-048).
 *
 * Built from the viewer's own assignment rows: the assignment is the
 * authorization, and round membership or track ownership grant nothing on
 * their own (D-035(1)). Rounds are walked in the event's own order, which also
 * drops any assignment belonging to a different event.
 */
export async function loadViewerScorecards(
  repos: Repos,
  eventId: string,
  viewerId: string,
  submissionId: string,
): Promise<ViewerScorecard[]> {
  const mine = (await repos.reviewRounds.listAssignmentsByReviewer(viewerId)).filter(
    (assignment) => assignment.submissionId === submissionId,
  );
  if (mine.length === 0) return [];

  const [rounds, scores] = await Promise.all([
    repos.reviewRounds.listByEvent(eventId),
    repos.reviewRounds.listScoresByAssignments(mine.map((assignment) => assignment.id)),
  ]);
  const scoreByAssignment = new Map(scores.map((score) => [score.assignmentId, score]));

  const cards: ViewerScorecard[] = [];
  for (const round of rounds) {
    const assignment = mine.find((row) => row.roundId === round.id);
    if (!assignment) continue;
    const score = scoreByAssignment.get(assignment.id);
    cards.push({
      round,
      assignment,
      values: score?.values ?? {},
      submitted: Boolean(score),
      open: isRoundOpen(round),
    });
  }
  return cards;
}

/** The tracks a reviewer owns *on this event*; admins get an empty list and
 * are never filtered by it. */
export async function reviewerTrackIdsFor(
  repos: Repos,
  viewer: SessionUser,
  eventId: string,
): Promise<string[]> {
  if (viewer.role !== "reviewer") return [];
  const tracks = await repos.tracks.listByReviewer(viewer.id);
  return tracks.filter((track) => track.eventId === eventId).map((track) => track.id);
}

/**
 * Every submission this viewer may see, with the columns the table shows.
 * Tracks, speakers, and reviews are each fetched in one batch — the table
 * must not cost a query per row.
 */
export async function loadSubmissionQueue(
  repos: Repos,
  event: Event,
  viewer: SessionUser,
): Promise<SubmissionQueue> {
  const [all, tracks, reviewerTrackIds, directFormIds] = await Promise.all([
    repos.submissions.listByEvent(event.id),
    repos.tracks.listByEvent(event.id),
    reviewerTrackIdsFor(repos, viewer, event.id),
    directSessionFormIds(repos, event.id),
  ]);

  const trackLinks = await repos.submissions.listTracksBySubmissionIds(all.map((s) => s.id));
  const trackIdsBySubmission: Record<string, string[]> = {};
  for (const link of trackLinks) {
    trackIdsBySubmission[link.submissionId] = [
      ...(trackIdsBySubmission[link.submissionId] ?? []),
      link.trackId,
    ];
  }

  const submissions = visibleSubmissions(
    all,
    trackIdsBySubmission,
    viewer.role,
    reviewerTrackIds,
    { directSessionFormIds: directFormIds },
  );

  const [speakerLinks, reviews, rollups] = await Promise.all([
    repos.submissions.listSpeakersBySubmissionIds(submissions.map((s) => s.id)),
    repos.reviews.listBySubmissionIds(submissions.map((s) => s.id)),
    // Rounds roll up onto the record for the organizer only (D-048, D-035).
    viewer.role === "admin"
      ? loadRoundRollups(repos, event.id)
      : Promise.resolve<Record<string, SubmissionRollup>>({}),
  ]);
  const people = await repos.users.listByIds([...new Set(speakerLinks.map((l) => l.userId))]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const trackNameById = new Map(tracks.map((track) => [track.id, track.name]));
  const tallies = tallyReviewsBySubmission(reviews);

  const speakersBySubmission = new Map<string, Array<Pick<User, "id" | "name" | "email">>>();
  // Primary speaker first: they are the person an organizer chases.
  const ordered = [...speakerLinks].sort((a, b) =>
    a.role === "primary" ? -1 : b.role === "primary" ? 1 : 0,
  );
  for (const link of ordered) {
    const person = peopleById.get(link.userId);
    if (!person) continue;
    speakersBySubmission.set(link.submissionId, [
      ...(speakersBySubmission.get(link.submissionId) ?? []),
      { id: person.id, name: person.name, email: person.email },
    ]);
  }

  const rows: QueueRow[] = submissions.map((submission) => {
    const trackIds = trackIdsBySubmission[submission.id] ?? [];
    return {
      submission,
      trackIds,
      trackNames: trackIds
        .map((id) => trackNameById.get(id))
        .filter((name): name is string => Boolean(name)),
      speakers: speakersBySubmission.get(submission.id) ?? [],
      tally: tallies[submission.id] ?? {
        total: 0,
        approve: 0,
        maybe: 0,
        deny: 0,
        voted: 0,
        averageScore: null,
        leaning: null,
      },
      rollup: rollupFor(rollups, submission.id),
    };
  });

  return { rows, tracks, reviewerTrackIds, directSessionFormIds: directFormIds };
}

// ---------------------------------------------------------------------------
// Filters (spec.md "Important": submission table filters/sorting/statuses)
// ---------------------------------------------------------------------------

export function filterQueue(rows: QueueRow[], filter: QueueFilter): QueueRow[] {
  return rows.filter((row) => {
    if (filter.status !== ALL && row.submission.status !== filter.status) return false;
    if (filter.track !== ALL && !row.trackIds.includes(filter.track)) return false;
    return true;
  });
}

/**
 * How review activity reads in a table cell: "1 scorecard · 2 approve", or "".
 *
 * Both sources count (decisions.md D-048) — a filed round scorecard is review
 * work, so the cell must never read as "—" while one exists. Scorecards lead
 * because they are the scored, structured signal.
 */
export function summarizeTally(tally: ReviewTally, scorecards = 0): string {
  const parts: string[] = [];
  if (scorecards > 0) parts.push(`${scorecards} scorecard${scorecards === 1 ? "" : "s"}`);
  if (tally.approve > 0) parts.push(`${tally.approve} approve`);
  if (tally.maybe > 0) parts.push(`${tally.maybe} maybe`);
  if (tally.deny > 0) parts.push(`${tally.deny} deny`);
  if (tally.total > 0 && parts.length === (scorecards > 0 ? 1 : 0)) {
    parts.push(`${tally.total} comment${tally.total === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

/** A person's display name, falling back to their address. */
export function personName(person: { name: string | null; email: string }): string {
  return person.name?.trim() || person.email;
}
