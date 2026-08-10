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
  // The *derived* confirmation (D-017): attached to one of this event's
  // sessions. Since D-068 this is only the default — an organizer's stored
  // status on the `event_speakers` record overrides it below.
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
      buildSpeakerRollups({
        speakers,
        confirmedSpeakerIds,
        assignmentsBySpeaker,
        tasksById,
        // The organizer's stored answers (decisions.md D-068). Only members
        // can have one; everyone else has no `event_speakers` row, so they
        // stay on the derivation, which is also what an unset member does.
        confirmationBySpeaker: new Map(
          members.map((member) => [member.userId, member.confirmationStatus]),
        ),
      }),
    ),
    tasksById,
    sessionsBySpeaker,
    notesBySpeaker: new Map(members.map((member) => [member.userId, member.notes])),
  };
}
