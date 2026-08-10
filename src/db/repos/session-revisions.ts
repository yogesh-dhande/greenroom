import type { NewSessionRevision, SessionRevision } from "@/db/entities";

/**
 * Abstract revision history (decisions.md D-071) — every edit that actually
 * changed a session's abstract, whoever made it.
 *
 * Append-only, like `FileCommentsRepo`: a revision is a record of what
 * happened, so there is no update or delete. Rows disappear only with their
 * session (cascade).
 */
export interface SessionRevisionsRepo {
  /** One entry — what a restore reads before writing its value back, and
   * where the caller checks the entry belongs to the event it came from. */
  getById(id: string): Promise<SessionRevision | null>;
  /** Newest first — the order the admin history panel renders. */
  listBySession(sessionId: string): Promise<SessionRevision[]>;
  /** Batch variant for a page that renders history for a whole board. */
  listBySessions(sessionIds: string[]): Promise<SessionRevision[]>;
  create(input: NewSessionRevision): Promise<SessionRevision>;
}
