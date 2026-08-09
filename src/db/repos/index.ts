import type { EmailLogRepo } from "./email-log";
import type { EmailTemplatesRepo } from "./email-templates";
import type { EventsRepo } from "./events";
import type { FormsRepo } from "./forms";
import type { ReviewRoundsRepo } from "./review-rounds";
import type { ReviewsRepo } from "./reviews";
import type { RoomsRepo } from "./rooms";
import type { SessionsRepo } from "./sessions";
import type { SubmissionsRepo } from "./submissions";
import type { TaskAssignmentsRepo } from "./task-assignments";
import type { TasksRepo } from "./tasks";
import type { TracksRepo } from "./tracks";
import type { UsersRepo } from "./users";

export type { EventsRepo } from "./events";
export type { UsersRepo } from "./users";
export type { FormsRepo } from "./forms";
export type { SubmissionsRepo } from "./submissions";
export type { ReviewsRepo } from "./reviews";
export type { ReviewRoundsRepo } from "./review-rounds";
export type { TracksRepo } from "./tracks";
export type { RoomsRepo } from "./rooms";
export type { SessionsRepo } from "./sessions";
export type { TasksRepo } from "./tasks";
export type { TaskAssignmentsRepo } from "./task-assignments";
export type { EmailTemplatesRepo } from "./email-templates";
export type { EmailLogRepo } from "./email-log";

/**
 * The full set of repositories the app depends on. Route handlers/server
 * actions and domain services should receive this bundle (or the individual
 * repo they need) rather than importing a concrete adapter directly — see
 * src/db/repos/d1/index.ts for the D1-backed implementation.
 */
export interface Repos {
  events: EventsRepo;
  users: UsersRepo;
  forms: FormsRepo;
  submissions: SubmissionsRepo;
  reviews: ReviewsRepo;
  reviewRounds: ReviewRoundsRepo;
  tracks: TracksRepo;
  rooms: RoomsRepo;
  sessions: SessionsRepo;
  tasks: TasksRepo;
  taskAssignments: TaskAssignmentsRepo;
  emailTemplates: EmailTemplatesRepo;
  emailLog: EmailLogRepo;
}
