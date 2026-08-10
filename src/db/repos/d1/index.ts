import type { Repos } from "@/db/repos";
import { createDb } from "./client";
import { createApiCredentialsRepo } from "./api-credentials";
import { createContactsRepo } from "./contacts";
import { createEmailLogRepo } from "./email-log";
import { createEmailTemplatesRepo } from "./email-templates";
import { createEventSpeakersRepo } from "./event-speakers";
import { createEventsRepo } from "./events";
import { createFileCommentsRepo } from "./file-comments";
import { createFileVersionsRepo } from "./file-versions";
import { createFormsRepo } from "./forms";
import { createPipelineRepo } from "./pipeline";
import { createReviewRoundsRepo } from "./review-rounds";
import { createReviewsRepo } from "./reviews";
import { createRoomsRepo } from "./rooms";
import { createSegmentsRepo } from "./segments";
import { createSessionRevisionsRepo } from "./session-revisions";
import { createSessionsRepo } from "./sessions";
import { createSubmissionsRepo } from "./submissions";
import { createTaskAssignmentsRepo } from "./task-assignments";
import { createTasksRepo } from "./tasks";
import { createTracksRepo } from "./tracks";
import { createUsersRepo } from "./users";

/**
 * The only place in the app that wires the storage-agnostic repo interfaces
 * (src/db/repos/*.ts) to a concrete D1 + Drizzle implementation. Swapping
 * datastores (decisions.md D-002) means adding a sibling directory (e.g.
 * src/db/repos/postgres/) with the same shape and changing this file only.
 */
export function createD1Repos(d1: D1Database): Repos {
  const db = createDb(d1);
  return {
    apiCredentials: createApiCredentialsRepo(db),
    events: createEventsRepo(db),
    users: createUsersRepo(db),
    eventSpeakers: createEventSpeakersRepo(db),
    forms: createFormsRepo(db),
    submissions: createSubmissionsRepo(db),
    reviews: createReviewsRepo(db),
    reviewRounds: createReviewRoundsRepo(db),
    tracks: createTracksRepo(db),
    rooms: createRoomsRepo(db),
    sessions: createSessionsRepo(db),
    sessionRevisions: createSessionRevisionsRepo(db),
    tasks: createTasksRepo(db),
    taskAssignments: createTaskAssignmentsRepo(db),
    fileVersions: createFileVersionsRepo(db),
    fileComments: createFileCommentsRepo(db),
    emailTemplates: createEmailTemplatesRepo(db),
    emailLog: createEmailLogRepo(db),
    contacts: createContactsRepo(db),
    pipeline: createPipelineRepo(db),
    segments: createSegmentsRepo(db),
  };
}
