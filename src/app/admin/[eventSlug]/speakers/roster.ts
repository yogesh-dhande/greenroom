import type { Repos } from "@/db/repos";
import type { Session, Task, TaskAssignment } from "@/db/entities";
import {
  buildSpeakerRollups,
  rosterSpeakerIds,
  sortSpeakerRollups,
  type SpeakerRollup,
} from "@/domain/onboarding";

/**
 * Everything both speaker surfaces read: the roster table (./page.tsx) and one
 * speaker's record (./[speakerId]/page.tsx).
 *
 * Loaded in one place so the two agree on membership — the record page uses
 * this to decide whether a speaker belongs to this event at all, which is
 * also its event-scoping guard (decisions.md D-045): an id from another
 * event's roster resolves to nothing here and 404s.
 */
export interface SpeakerRoster {
  rollups: SpeakerRollup[];
  tasksById: Map<string, Task>;
  sessionsBySpeaker: Map<string, Session[]>;
  /** Organizer-only notes, by speaker id (decisions.md D-051). */
  notesBySpeaker: Map<string, string | null>;
}

export async function loadSpeakerRoster(repos: Repos, eventId: string): Promise<SpeakerRoster> {
  const [sessions, tasks, assignments, members] = await Promise.all([
    repos.sessions.listByEvent(eventId),
    repos.tasks.listByEvent(eventId),
    repos.taskAssignments.listByEvent(eventId),
    repos.eventSpeakers.listByEvent(eventId),
  ]);

  const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
    sessions.map((session) => session.id),
  );
  const confirmedSpeakerIds = new Set(sessionSpeakerRows.map((row) => row.userId));

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsBySpeaker = new Map<string, Session[]>();
  for (const row of sessionSpeakerRows) {
    const session = sessionById.get(row.sessionId);
    if (!session) continue;
    const list = sessionsBySpeaker.get(row.userId) ?? [];
    list.push(session);
    sessionsBySpeaker.set(row.userId, list);
  }

  const assignmentsBySpeaker = new Map<string, TaskAssignment[]>();
  for (const assignment of assignments) {
    const list = assignmentsBySpeaker.get(assignment.speakerId) ?? [];
    list.push(assignment);
    assignmentsBySpeaker.set(assignment.speakerId, list);
  }

  const speakerIds = rosterSpeakerIds({
    confirmedSpeakerIds,
    assignedSpeakerIds: assignmentsBySpeaker.keys(),
    memberSpeakerIds: members.map((member) => member.userId),
  });
  const speakers = await repos.users.listByIds([...speakerIds]);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return {
    rollups: sortSpeakerRollups(
      buildSpeakerRollups({ speakers, confirmedSpeakerIds, assignmentsBySpeaker, tasksById }),
    ),
    tasksById,
    sessionsBySpeaker,
    notesBySpeaker: new Map(members.map((member) => [member.userId, member.notes])),
  };
}
