import type { ContactsRepo } from "./contacts";
import type { EmailLogRepo } from "./email-log";
import type { EmailTemplatesRepo } from "./email-templates";
import type { EventSpeakersRepo } from "./event-speakers";
import type { EventsRepo } from "./events";
import type { FileCommentsRepo } from "./file-comments";
import type { FileVersionsRepo } from "./file-versions";
import type { FormsRepo } from "./forms";
import type { PipelineRepo } from "./pipeline";
import type { ReviewRoundsRepo } from "./review-rounds";
import type { ReviewsRepo } from "./reviews";
import type { RoomsRepo } from "./rooms";
import type { SegmentsRepo } from "./segments";
import type { SessionRevisionsRepo } from "./session-revisions";
import type { SessionsRepo } from "./sessions";
import type { SubmissionsRepo } from "./submissions";
import type { TaskAssignmentsRepo } from "./task-assignments";
import type { TasksRepo } from "./tasks";
import type { TracksRepo } from "./tracks";
import type { UsersRepo } from "./users";

export type { EventsRepo } from "./events";
export type { EventSpeakersRepo } from "./event-speakers";
export type { UsersRepo } from "./users";
export type { FormsRepo } from "./forms";
export type { SubmissionsRepo } from "./submissions";
export type { ReviewsRepo } from "./reviews";
export type { ReviewRoundsRepo } from "./review-rounds";
export type { TracksRepo } from "./tracks";
export type { RoomsRepo } from "./rooms";
export type { SessionsRepo } from "./sessions";
export type { SessionRevisionsRepo } from "./session-revisions";
export type { TasksRepo } from "./tasks";
export type { TaskAssignmentsRepo } from "./task-assignments";
export type { FileVersionsRepo } from "./file-versions";
export type { FileCommentsRepo } from "./file-comments";
export type { EmailTemplatesRepo } from "./email-templates";
export type { EmailLogRepo } from "./email-log";
export type {
  ContactsRepo,
  ContactDetail,
  ContactEventLink,
  DirectoryContact,
  DirectoryFilter,
} from "./contacts";
export type {
  PipelineRepo,
  EnrollInput,
  PipelineCardWithHistory,
  StageMoveResult,
} from "./pipeline";
export type { SegmentsRepo } from "./segments";

/**
 * The full set of repositories the app depends on. Route handlers/server
 * actions and domain services should receive this bundle (or the individual
 * repo they need) rather than importing a concrete adapter directly — see
 * src/db/repos/d1/index.ts for the D1-backed implementation.
 */
export interface Repos {
  events: EventsRepo;
  users: UsersRepo;
  /** Per-event speaker records: organizer notes + roster membership (D-051). */
  eventSpeakers: EventSpeakersRepo;
  forms: FormsRepo;
  submissions: SubmissionsRepo;
  reviews: ReviewsRepo;
  reviewRounds: ReviewRoundsRepo;
  tracks: TracksRepo;
  rooms: RoomsRepo;
  sessions: SessionsRepo;
  /** Append-only abstract history for a session (D-071). */
  sessionRevisions: SessionRevisionsRepo;
  tasks: TasksRepo;
  taskAssignments: TaskAssignmentsRepo;
  /** Upload history and the comment thread on a deliverable (D-054). */
  fileVersions: FileVersionsRepo;
  fileComments: FileCommentsRepo;
  emailTemplates: EmailTemplatesRepo;
  emailLog: EmailLogRepo;
  /**
   * Org-level speaker CRM (decisions.md D-077). These three are deliberately
   * *not* event-scoped: the directory, the sourcing board and saved segments
   * span every event, which is the whole point of the area. Event-scoped
   * speaker data still lives on `eventSpeakers` above.
   */
  contacts: ContactsRepo;
  pipeline: PipelineRepo;
  segments: SegmentsRepo;
}
