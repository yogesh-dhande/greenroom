import { createsSessionsDirectly, type Event, type Submission, type Track, type User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { tallyReviewsBySubmission, visibleSubmissions, type ReviewTally } from "@/domain/review";
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

  const [speakerLinks, reviews] = await Promise.all([
    repos.submissions.listSpeakersBySubmissionIds(submissions.map((s) => s.id)),
    repos.reviews.listBySubmissionIds(submissions.map((s) => s.id)),
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

/** How a review tally reads in a table cell: "2 approve · 1 deny", or "—". */
export function summarizeTally(tally: ReviewTally): string {
  const parts: string[] = [];
  if (tally.approve > 0) parts.push(`${tally.approve} approve`);
  if (tally.maybe > 0) parts.push(`${tally.maybe} maybe`);
  if (tally.deny > 0) parts.push(`${tally.deny} deny`);
  if (parts.length === 0 && tally.total > 0) {
    return `${tally.total} comment${tally.total === 1 ? "" : "s"}`;
  }
  return parts.join(" · ");
}

/** A person's display name, falling back to their address. */
export function personName(person: { name: string | null; email: string }): string {
  return person.name?.trim() || person.email;
}
