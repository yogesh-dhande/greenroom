import type { FileVersion, NewFileVersion } from "@/db/entities";

/**
 * Upload history for a `file_request` assignment (decisions.md D-054).
 *
 * Append-only by design: there is no update or delete, because a replacement
 * deliverable is a new version and an organizer must always be able to see
 * what was sent before.
 */
export interface FileVersionsRepo {
  listByAssignment(assignmentId: string): Promise<FileVersion[]>;
  /** Batch variant: the Files library resolves history for every deliverable
   * in an event and must not run one query per row. */
  listByAssignments(assignmentIds: string[]): Promise<FileVersion[]>;
  create(input: NewFileVersion): Promise<FileVersion>;
}
