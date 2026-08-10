import type { FileVersion, NewFileVersion } from "@/db/entities";

/**
 * Upload history for a `file_request` assignment and for a speaker's profile
 * files (decisions.md D-054).
 *
 * Append-only by design: there is no update or delete, because a replacement
 * deliverable is a new version and an organizer must always be able to see
 * what was sent before. That holds for profile headshots too — replacing one
 * appends a version rather than rewriting the old row.
 */
export interface FileVersionsRepo {
  listByAssignment(assignmentId: string): Promise<FileVersion[]>;
  /** Batch variant: the Files library resolves history for every deliverable
   * in an event and must not run one query per row. */
  listByAssignments(assignmentIds: string[]): Promise<FileVersion[]>;
  /** Profile-scoped rows for a set of speakers — the Files library and a
   * speaker's record both need a whole roster's worth in one query. */
  listProfileVersionsByOwners(ownerUserIds: string[]): Promise<FileVersion[]>;
  /** Pass `assignmentId` for a deliverable, or `scope: "profile"` with
   * `ownerUserId` for a file attached to a speaker rather than a task. */
  create(input: NewFileVersion): Promise<FileVersion>;
}
