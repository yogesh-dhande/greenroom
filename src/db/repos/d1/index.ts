import type { Repos } from "@/db/repos";
import { createDb } from "./client";
import { createEmailLogRepo } from "./email-log";
import { createEmailTemplatesRepo } from "./email-templates";
import { createEventsRepo } from "./events";
import { createFormsRepo } from "./forms";
import { createReviewRoundsRepo } from "./review-rounds";
import { createReviewsRepo } from "./reviews";
import { createRoomsRepo } from "./rooms";
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
    events: createEventsRepo(db),
    users: createUsersRepo(db),
    forms: createFormsRepo(db),
    submissions: createSubmissionsRepo(db),
    reviews: createReviewsRepo(db),
    reviewRounds: createReviewRoundsRepo(db),
    tracks: createTracksRepo(db),
    rooms: createRoomsRepo(db),
    sessions: createSessionsRepo(db),
    tasks: createTasksRepo(db),
    taskAssignments: createTaskAssignmentsRepo(db),
    emailTemplates: createEmailTemplatesRepo(db),
    emailLog: createEmailLogRepo(db),
  };
}
