import type {
  Event,
  ReviewRound,
  RoundAssignment,
  RoundScore,
  Submission,
  User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import { summarizeRound, type ResultRow } from "@/domain/rounds";
import { submissionStatusLabel } from "@/components/submission-status-badge";
import { formatShortDate } from "@/lib/event-time";
import { personName } from "../submissions/queue";

/**
 * Reads for the review-rounds screens (spec.md "Important" — multi-round
 * scored evaluations, decisions.md D-031).
 *
 * Kept beside the pages that use it, like the submission queue's own loader:
 * this is batched assembly of repo reads for a handful of screens, with every
 * actual rule (aggregation, progress, scoping) imported from
 * src/domain/rounds.ts.
 */

/** "Aug 1 – Oct 15" for a round's window, in the event's own timezone. */
export function roundWindowLabel(round: ReviewRound, timezone: string): string {
  const opens = round.opensAt ? formatShortDate(round.opensAt, timezone) : null;
  const closes = round.closesAt ? formatShortDate(round.closesAt, timezone) : null;
  if (opens && closes) return `${opens} – ${closes}`;
  if (opens) return `Opens ${opens}`;
  if (closes) return `Closes ${closes}`;
  return "No dates set";
}

/** Statuses that are still worth reviewing — drafts were never submitted. */
const REVIEWABLE_STATUSES = new Set(["submitted", "approved", "maybe", "denied"]);

export interface RoundSubmissionRow {
  submission: Submission;
  trackIds: string[];
  trackNames: string[];
  /** Everyone on the talk, primary speaker first (spec.md §2 co-speakers). */
  speakers: Array<Pick<User, "id" | "name" | "email">>;
}

/** The round and its event, or null when either is missing/mismatched. */
export async function loadRound(
  repos: Repos,
  eventSlug: string,
  roundId: string,
): Promise<{ event: Event; round: ReviewRound } | null> {
  const [event, round] = await Promise.all([
    repos.events.getBySlug(eventSlug),
    repos.reviewRounds.getById(roundId),
  ]);
  if (!event || !round || round.eventId !== event.id) return null;
  return { event, round };
}

/**
 * Every submission that could be put in front of a reviewer, with the columns
 * the assignment and results tables show. Tracks and speakers are each fetched
 * in one batch — these tables must not cost a query per row.
 */
export async function loadRoundSubmissions(
  repos: Repos,
  eventId: string,
): Promise<RoundSubmissionRow[]> {
  const [all, tracks] = await Promise.all([
    repos.submissions.listByEvent(eventId),
    repos.tracks.listByEvent(eventId),
  ]);
  const submissions = all.filter((submission) => REVIEWABLE_STATUSES.has(submission.status));
  const ids = submissions.map((submission) => submission.id);

  const [trackLinks, speakerLinks] = await Promise.all([
    repos.submissions.listTracksBySubmissionIds(ids),
    repos.submissions.listSpeakersBySubmissionIds(ids),
  ]);
  const people = await repos.users.listByIds([...new Set(speakerLinks.map((l) => l.userId))]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const trackNameById = new Map(tracks.map((track) => [track.id, track.name]));

  const trackIdsBySubmission = new Map<string, string[]>();
  for (const link of trackLinks) {
    trackIdsBySubmission.set(link.submissionId, [
      ...(trackIdsBySubmission.get(link.submissionId) ?? []),
      link.trackId,
    ]);
  }

  const speakersBySubmission = new Map<string, Array<Pick<User, "id" | "name" | "email">>>();
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

  return submissions.map((submission) => {
    const trackIds = trackIdsBySubmission.get(submission.id) ?? [];
    return {
      submission,
      trackIds,
      trackNames: trackIds
        .map((id) => trackNameById.get(id))
        .filter((name): name is string => Boolean(name)),
      speakers: speakersBySubmission.get(submission.id) ?? [],
    };
  });
}

/** Assignments plus the scorecards filed against them, for one round. */
export async function loadRoundWork(
  repos: Repos,
  roundId: string,
): Promise<{ assignments: RoundAssignment[]; scores: RoundScore[] }> {
  const assignments = await repos.reviewRounds.listAssignments(roundId);
  const scores = await repos.reviewRounds.listScoresByAssignments(
    assignments.map((assignment) => assignment.id),
  );
  return { assignments, scores };
}

/**
 * The results table's rows: one per submission in the round, carrying the
 * aggregate and the speaker/track columns an organizer reads it by.
 */
export function buildResultRows(
  round: ReviewRound,
  submissions: RoundSubmissionRow[],
  assignments: RoundAssignment[],
  scores: RoundScore[],
): ResultRow[] {
  const summaries = summarizeRound(round.criteria, assignments, scores);
  const rowById = new Map(submissions.map((row) => [row.submission.id, row]));
  return summaries
    .map((summary) => {
      const row = rowById.get(summary.submissionId);
      if (!row) return null;
      return {
        submissionId: summary.submissionId,
        title: row.submission.title,
        speakers: row.speakers.map((person) => personName(person)),
        trackNames: row.trackNames,
        status: submissionStatusLabel(row.submission.status),
        summary,
      } satisfies ResultRow;
    })
    .filter((row): row is ResultRow => row !== null);
}

/** The people an organizer can hand review work to (spec.md "Users"). */
export async function loadReviewerPool(repos: Repos): Promise<User[]> {
  const [reviewers, admins] = await Promise.all([
    repos.users.listByRole("reviewer"),
    repos.users.listByRole("admin"),
  ]);
  // Admins sit on program committees too; they're offered after the reviewers.
  return [...reviewers, ...admins].sort((a, b) => personName(a).localeCompare(personName(b)));
}
