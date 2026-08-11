import type { FileComment, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { buildAssignmentViews, rosterSpeakerIds } from "@/domain/onboarding";
import {
  collectDeliverables,
  groupByAssignment,
  groupProfileVersionsBySpeaker,
  type Deliverable,
} from "@/domain/files";

/**
 * The one read behind the Files library (spec.md section 6, decisions.md
 * D-054), shared by the page and by the "Download all" route handler beside
 * it (D-073).
 *
 * Kept beside the pages that use it, like the review rounds' own loader: this
 * is batched assembly of repo reads, with every rule (which upload is current,
 * how a thread reads) imported from src/domain/files.ts. It is shared rather
 * than duplicated so the archive can never contain a different set of files
 * from the table the organizer clicked "Download all" on.
 */

export interface FileLibrary {
  /** Current file first, newest upload at the top -- the table's own order. */
  deliverables: Deliverable[];
  commentsByAssignment: Map<string, FileComment[]>;
  /** Speakers behind the uploads and authors behind the comments, in one
   * lookup -- the same person is usually both. */
  peopleById: Map<string, User>;
  /** Speaker id -> the titles of the sessions they are on. */
  sessionTitlesBySpeaker: Map<string, string[]>;
  /** Speaker id -> stable session links for the Files table and its
   * session-scoped entry point. Task uploads are speaker-wide, so a speaker
   * with multiple talks intentionally contributes every one of those links. */
  sessionRefsBySpeaker: Map<string, Array<{ id: string; title: string }>>;
  /** Session metadata and its speakers, assembled from the same batched read
   * so the session-scoped library adds no duplicate repository queries. */
  sessions: Array<{ id: string; title: string }>;
  speakerIdsBySession: Map<string, string[]>;
}

export async function loadFileLibrary(repos: Repos, eventId: string): Promise<FileLibrary> {
  const [assignments, tasks, forms, sessions, members] = await Promise.all([
    repos.taskAssignments.listByEvent(eventId),
    repos.tasks.listByEvent(eventId),
    repos.forms.listByEvent(eventId),
    repos.sessions.listByEvent(eventId),
    repos.eventSpeakers.listByEvent(eventId),
  ]);

  // Speaker -> session titles, the same shape the speaker roster builds
  // (src/app/admin/[eventSlug]/speakers/roster.ts) so a file's row can show
  // which talk(s) its speaker is on.
  const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
    sessions.map((session) => session.id),
  );
  const sessionTitleById = new Map(sessions.map((session) => [session.id, session.title]));
  const sessionTitlesBySpeaker = new Map<string, string[]>();
  const sessionRefsBySpeaker = new Map<string, Array<{ id: string; title: string }>>();
  const speakerIdsBySession = new Map<string, string[]>();
  for (const row of sessionSpeakerRows) {
    const title = sessionTitleById.get(row.sessionId);
    if (!title) continue;
    const list = sessionTitlesBySpeaker.get(row.userId) ?? [];
    list.push(title);
    sessionTitlesBySpeaker.set(row.userId, list);
    const refs = sessionRefsBySpeaker.get(row.userId) ?? [];
    refs.push({ id: row.sessionId, title });
    sessionRefsBySpeaker.set(row.userId, refs);
    const speakerIds = speakerIdsBySession.get(row.sessionId) ?? [];
    speakerIds.push(row.userId);
    speakerIdsBySession.set(row.sessionId, speakerIds);
  }

  // Profile files (headshots) belong to a speaker rather than to a task, so
  // they are fetched per roster member instead of per assignment. Membership
  // is resolved from the same three sources the roster itself uses
  // (src/app/admin/[eventSlug]/speakers/roster.ts) so a speaker who has a
  // headshot but no assignment still contributes their file.
  const rosterIds = rosterSpeakerIds({
    confirmedSpeakerIds: new Set(sessionSpeakerRows.map((row) => row.userId)),
    assignedSpeakerIds: assignments.map((assignment) => assignment.speakerId),
    memberSpeakerIds: members.map((member) => member.userId),
  });

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [versions, comments, profileVersions, rosterPeople] = await Promise.all([
    repos.fileVersions.listByAssignments(assignmentIds),
    repos.fileComments.listByAssignments(assignmentIds),
    repos.fileVersions.listProfileVersionsByOwners([...rosterIds]),
    repos.users.listByIds([...rosterIds]),
  ]);

  const deliverables = collectDeliverables({
    views: buildAssignmentViews(assignments, new Map(tasks.map((task) => [task.id, task]))),
    formsById: new Map(forms.map((form) => [form.id, form])),
    versionsByAssignment: groupByAssignment(versions),
    profileVersionsBySpeaker: groupProfileVersionsBySpeaker(profileVersions),
    profileCurrentUrlBySpeaker: new Map(
      rosterPeople.map((person) => [person.id, person.headshotUrl] as const),
    ),
  });

  const people = await repos.users.listByIds(
    Array.from(
      new Set([
        ...deliverables.map((deliverable) => deliverable.speakerId),
        // Usually the speaker themself, but an organizer can supply a
        // headshot on a speaker's behalf -- that row's uploader is the one
        // name the Speaker column doesn't already carry.
        ...deliverables.flatMap((deliverable) => deliverable.current.uploadedBy ?? []),
        ...comments.map((comment) => comment.authorId),
      ]),
    ),
  );

  return {
    deliverables,
    commentsByAssignment: groupByAssignment(comments),
    peopleById: new Map(people.map((person) => [person.id, person])),
    sessionTitlesBySpeaker,
    sessionRefsBySpeaker,
    sessions: sessions.map((session) => ({ id: session.id, title: session.title })),
    speakerIdsBySession,
  };
}

/** How a speaker is named in the library and in the export's folder names. */
export function speakerLabels(peopleById: Map<string, User>): Map<string, string> {
  return new Map(
    Array.from(peopleById, ([id, person]) => [id, person.name ?? person.email] as const),
  );
}
