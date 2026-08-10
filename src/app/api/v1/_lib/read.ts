import type { EventSpeaker, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  AdminWorkflowError,
  suggestSessionSlot as suggestAdminSessionSlot,
} from "@/domain/admin-api";
import {
  toApiEventDetail,
  toApiEventList,
  toApiRoom,
  toApiSessionDetail,
  toApiSessionList,
  toApiSpeakerDetail,
  toApiSpeakerList,
  toApiSubmissionDetail,
  toApiSubmissionList,
  toApiTask,
  toApiTrack,
} from "@/domain/api-dtos";
import { authenticateApiRead, notFound } from "@/lib/api-request";
import { getRepos } from "@/lib/db";

export async function apiEventContext(request: Request, eventId: string) {
  const auth = await authenticateApiRead(request, eventId);
  const repos = await getRepos();
  const event = await repos.events.getById(eventId);
  if (!event) notFound("Event");
  return { auth, repos, event };
}

export async function listEvents(request: Request) {
  const auth = await authenticateApiRead(request);
  const repos = await getRepos();
  const events = await repos.events.listAll();
  const visible =
    auth.eventScope === "all"
      ? events
      : events.filter((event) => auth.eventScope.includes(event.id));
  return visible.map(toApiEventList);
}

export async function getEvent(request: Request, eventId: string) {
  const { event } = await apiEventContext(request, eventId);
  return toApiEventDetail(event);
}

export async function listTracks(request: Request, eventId: string) {
  const { repos } = await apiEventContext(request, eventId);
  return (await repos.tracks.listByEvent(eventId)).map(toApiTrack);
}

export async function listRooms(request: Request, eventId: string) {
  const { repos } = await apiEventContext(request, eventId);
  return (await repos.rooms.listByEvent(eventId)).map(toApiRoom);
}

export async function listTasks(request: Request, eventId: string) {
  const { repos } = await apiEventContext(request, eventId);
  return (await repos.tasks.listByEvent(eventId)).map(toApiTask);
}

export async function listSessions(request: Request, eventId: string) {
  const { repos } = await apiEventContext(request, eventId);
  const [sessions, tracks, rooms] = await Promise.all([
    repos.sessions.listByEvent(eventId),
    repos.tracks.listByEvent(eventId),
    repos.rooms.listByEvent(eventId),
  ]);
  const links = await repos.sessions.listSpeakersBySessionIds(sessions.map((session) => session.id));
  const speakerIdsBySession = groupIds(links, "sessionId", "userId");
  const people = await repos.users.listByIds([...new Set(links.map((link) => link.userId))]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return sessions.map((session) =>
    toApiSessionList(session, {
      speakers: (speakerIdsBySession.get(session.id) ?? []).flatMap((id) =>
        peopleById.has(id) ? [peopleById.get(id)!] : [],
      ),
      track: session.trackId ? (trackById.get(session.trackId) ?? null) : null,
      room: session.roomId ? (roomById.get(session.roomId) ?? null) : null,
    }),
  );
}

export async function getSession(request: Request, eventId: string, sessionId: string) {
  const { repos } = await apiEventContext(request, eventId);
  const session = await repos.sessions.getById(sessionId);
  if (!session || session.eventId !== eventId) notFound("Session");

  const [links, track, room] = await Promise.all([
    repos.sessions.listSpeakersBySessionIds([session.id]),
    session.trackId ? repos.tracks.getById(session.trackId) : Promise.resolve(null),
    session.roomId ? repos.rooms.getById(session.roomId) : Promise.resolve(null),
  ]);
  const speakers = await repos.users.listByIds(links.map((link) => link.userId));
  return toApiSessionDetail(session, { speakers, track, room });
}

export async function suggestSessionSlot(request: Request, eventId: string, sessionId: string) {
  const { repos, event } = await apiEventContext(request, eventId);
  try {
    return {
      suggestion: await suggestAdminSessionSlot({ repos }, eventId, sessionId),
      timezone: event.timezone,
    };
  } catch (error) {
    if (error instanceof AdminWorkflowError && error.code === "not_found") {
      notFound(error.message.replace(/ not found$/i, ""));
    }
    throw error;
  }
}

interface SpeakerApiRows {
  list: ReturnType<typeof toApiSpeakerList>[];
  byId: Map<string, { user: User; member: EventSpeaker | null; sessionIds: string[] }>;
}

export async function speakerRows(repos: Repos, eventId: string): Promise<SpeakerApiRows> {
  const [sessions, assignments, members] = await Promise.all([
    repos.sessions.listByEvent(eventId),
    repos.taskAssignments.listByEvent(eventId),
    repos.eventSpeakers.listByEvent(eventId),
  ]);
  const links = await repos.sessions.listSpeakersBySessionIds(sessions.map((session) => session.id));
  const sessionIdsBySpeaker = groupIds(links, "userId", "sessionId");
  const memberBySpeaker = new Map(members.map((member) => [member.userId, member]));
  const speakerIds = new Set([
    ...memberBySpeaker.keys(),
    ...sessionIdsBySpeaker.keys(),
    ...assignments.map((assignment) => assignment.speakerId),
  ]);
  const people = await repos.users.listByIds([...speakerIds]);
  const byId = new Map(
    people.map((user) => [
      user.id,
      {
        user,
        member: memberBySpeaker.get(user.id) ?? null,
        sessionIds: sessionIdsBySpeaker.get(user.id) ?? [],
      },
    ]),
  );
  return {
    byId,
    list: [...byId.values()].map(({ user, member, sessionIds }) =>
      toApiSpeakerList(user, { eventSpeaker: member, sessionIds }),
    ),
  };
}

export async function listSpeakers(request: Request, eventId: string) {
  const { repos } = await apiEventContext(request, eventId);
  return (await speakerRows(repos, eventId)).list;
}

export async function getSpeaker(request: Request, eventId: string, speakerId: string) {
  const { repos } = await apiEventContext(request, eventId);
  const row = (await speakerRows(repos, eventId)).byId.get(speakerId);
  if (!row) notFound("Speaker");
  const sessions = await repos.sessions.listByEvent(eventId);
  const sessionIdSet = new Set(row.sessionIds);
  return toApiSpeakerDetail(row.user, {
    eventSpeaker: row.member,
    sessionIds: row.sessionIds,
    sessions: sessions.filter((session) => sessionIdSet.has(session.id)),
  });
}

export async function listSubmissions(request: Request, eventId: string) {
  const { repos } = await apiEventContext(request, eventId);
  const submissions = await repos.submissions.listByEvent(eventId);
  const [trackLinks, speakerLinks] = await Promise.all([
    repos.submissions.listTracksBySubmissionIds(submissions.map((submission) => submission.id)),
    repos.submissions.listSpeakersBySubmissionIds(submissions.map((submission) => submission.id)),
  ]);
  const trackIdsBySubmission = groupIds(trackLinks, "submissionId", "trackId");
  const [tracks, people] = await Promise.all([
    repos.tracks.listByEvent(eventId),
    repos.users.listByIds([...new Set(speakerLinks.map((link) => link.userId))]),
  ]);
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const speakersBySubmission = new Map<
    string,
    Array<{ user: User; role: (typeof speakerLinks)[number]["role"] }>
  >();
  for (const link of speakerLinks) {
    const user = peopleById.get(link.userId);
    if (!user) continue;
    speakersBySubmission.set(link.submissionId, [
      ...(speakersBySubmission.get(link.submissionId) ?? []),
      { user, role: link.role },
    ]);
  }
  return submissions.map((submission) =>
    toApiSubmissionList(submission, {
      tracks: (trackIdsBySubmission.get(submission.id) ?? []).flatMap((id) =>
        trackById.has(id) ? [trackById.get(id)!] : [],
      ),
      speakers: speakersBySubmission.get(submission.id) ?? [],
    }),
  );
}

export async function getSubmission(
  request: Request,
  eventId: string,
  submissionId: string,
) {
  const { repos } = await apiEventContext(request, eventId);
  const submission = await repos.submissions.getById(submissionId);
  if (!submission || submission.eventId !== eventId) notFound("Submission");

  const [trackIds, speakerLinks, form, convertedSession] = await Promise.all([
    repos.submissions.listTrackIds(submission.id),
    repos.submissions.listSpeakers(submission.id),
    repos.forms.getById(submission.formId),
    repos.sessions.getBySubmission(submission.id),
  ]);
  const [tracks, people] = await Promise.all([
    repos.tracks.listByIds(trackIds),
    repos.users.listByIds(speakerLinks.map((speaker) => speaker.userId)),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const speakers = speakerLinks.flatMap((link) => {
    const user = peopleById.get(link.userId);
    return user ? [{ user, role: link.role }] : [];
  });

  return toApiSubmissionDetail(submission, {
    tracks,
    speakers,
    form,
    sessionId: convertedSession?.id ?? null,
  });
}

function groupIds<T, K1 extends keyof T, K2 extends keyof T>(
  rows: T[],
  groupKey: K1,
  valueKey: K2,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = String(row[groupKey]);
    grouped.set(key, [...(grouped.get(key) ?? []), String(row[valueKey])]);
  }
  return grouped;
}
