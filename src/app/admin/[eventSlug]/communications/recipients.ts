import type { Repos } from "@/db/repos";

/**
 * Who the composer may write to, as opposed to who this event's log is about.
 *
 * The two sets are deliberately different. The log resolves names for everyone
 * an event's mail has ever concerned — reviewers included, since a round can
 * nudge them (decisions.md D-050) and those sends belong in the same history.
 * But a reviewer is not a speaker: offering them in the recipient picker puts
 * them one careless click (or one "All speakers" chip) away from a message
 * written for the lineup. Only people who hold something on the programme —
 * a session, a submission, an onboarding task, or a roster row (D-051's
 * manually added and CSV-imported speakers) — are recipients.
 *
 * Somebody who is both a reviewer and a speaker stays selectable: they qualify
 * through the speaker half, and the reviewer half never subtracts.
 */
export function eventRecipientIds(input: {
  /** Speakers attached to one of the event's sessions. */
  sessionSpeakerIds: Iterable<string>;
  /** Speakers on a submission — co-speakers still under review count. */
  submissionSpeakerIds: Iterable<string>;
  /** Anyone holding an onboarding task assignment. */
  assignedSpeakerIds: Iterable<string>;
  /** `event_speakers` rows: the roster itself (D-051), which is the only
   * source for a speaker added by hand or imported from a CSV. */
  rosterSpeakerIds: Iterable<string>;
}): Set<string> {
  return new Set<string>([
    ...input.sessionSpeakerIds,
    ...input.submissionSpeakerIds,
    ...input.assignedSpeakerIds,
    ...input.rosterSpeakerIds,
  ]);
}

/**
 * The same set read through the repos, for the server action that has only an
 * event and a list of ids to check. A server action is a public endpoint: the
 * page narrowing the picker means nothing until the write path re-derives who
 * was on offer and refuses the rest.
 */
export async function loadEventRecipientIds(repos: Repos, eventId: string): Promise<Set<string>> {
  const [sessions, submissions, assignments, roster] = await Promise.all([
    repos.sessions.listByEvent(eventId),
    repos.submissions.listByEvent(eventId),
    repos.taskAssignments.listByEvent(eventId),
    repos.eventSpeakers.listByEvent(eventId),
  ]);
  const [sessionLinks, submissionLinks] = await Promise.all([
    repos.sessions.listSpeakersBySessionIds(sessions.map((session) => session.id)),
    repos.submissions.listSpeakersBySubmissionIds(submissions.map((submission) => submission.id)),
  ]);

  return eventRecipientIds({
    sessionSpeakerIds: sessionLinks.map((link) => link.userId),
    submissionSpeakerIds: submissionLinks.map((link) => link.userId),
    assignedSpeakerIds: assignments.map((assignment) => assignment.speakerId),
    rosterSpeakerIds: roster.map((member) => member.userId),
  });
}
