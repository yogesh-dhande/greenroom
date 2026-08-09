import type { FileComment, NewFileComment } from "@/db/entities";

/**
 * The comment thread on a deliverable (decisions.md D-054), shared by the
 * speaker's portal task card and the organizer's Files library.
 *
 * Append-only: comments are neither edited nor deleted, so a thread reads the
 * same to both sides for good.
 */
export interface FileCommentsRepo {
  listByAssignment(assignmentId: string): Promise<FileComment[]>;
  /** Batch variant for the Files library, which shows a thread per row. */
  listByAssignments(assignmentIds: string[]): Promise<FileComment[]>;
  create(input: NewFileComment): Promise<FileComment>;
}
