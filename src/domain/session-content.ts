/**
 * Session *content* domain rules — editorial approval (decisions.md D-072)
 * and abstract revision history (D-071).
 *
 * Deliberately separate from src/domain/scheduling.ts: nothing here is read by
 * conflict detection, and nothing here changes a session's scheduling status
 * (draft/confirmed/cancelled). Pure functions only — no datastore imports; the
 * agenda's server actions call these and then write through the repos.
 */
import type { SessionContentStatus } from "@/db/entities";

// ---------------------------------------------------------------------------
// Approval status (D-072)
// ---------------------------------------------------------------------------

/** Editorial order — the way the control and the filter list them. */
export const SESSION_CONTENT_STATUSES: SessionContentStatus[] = [
  "draft",
  "in_review",
  "approved",
];

/** Organizer-facing labels. "Approved" is the only one the public ever sees
 * the effect of, so the other two say plainly that it is being held back. */
export const CONTENT_STATUS_LABEL: Record<SessionContentStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
};

/** One line under the control explaining what each choice does to the public
 * program — the gate is invisible otherwise. */
export const CONTENT_STATUS_HINT: Record<SessionContentStatus, string> = {
  draft: "Held back — not on the public program.",
  in_review: "Awaiting sign-off — not on the public program.",
  approved: "Live on the public program once the program is published.",
};

/** Sentinel for "any status" — a `<Select>` cannot hold an empty value, the
 * same convention `ANY_FACET` uses on the public schedule filters. */
export const ANY_CONTENT_STATUS = "all";

/**
 * The admin sessions filter predicate: `ANY_CONTENT_STATUS` (or an
 * unrecognised value, e.g. a hand-edited URL) matches everything, so the board
 * can never silently hide sessions an organizer didn't choose to hide.
 */
export function matchesContentStatus(
  session: { contentStatus: SessionContentStatus },
  chosen: string,
): boolean {
  if (chosen === ANY_CONTENT_STATUS) return true;
  if (!SESSION_CONTENT_STATUSES.includes(chosen as SessionContentStatus)) return true;
  return session.contentStatus === chosen;
}

/** Narrows a list of sessions by the chosen filter value. */
export function filterByContentStatus<T extends { contentStatus: SessionContentStatus }>(
  sessions: T[],
  chosen: string,
): T[] {
  return sessions.filter((session) => matchesContentStatus(session, chosen));
}

// ---------------------------------------------------------------------------
// Abstract revisions (D-071)
// ---------------------------------------------------------------------------

/**
 * The stored form of an abstract: trimmed, and empty-as-null. Both edit
 * surfaces already trim before saving, so comparing raw values would log a
 * revision for a stray trailing newline that never reaches the database.
 */
export function normalizeAbstract(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The two values a revision row records. */
export interface AbstractRevisionPlan {
  priorValue: string | null;
  newValue: string | null;
}

/**
 * What to append to the history for an abstract edit, or null when the edit
 * left the abstract as it was — an organizer retitling a session or moving it
 * to another track must not grow a revision row that says nothing.
 *
 * A first set (no abstract before, one now) *is* a revision, recorded with a
 * null `priorValue`; so is clearing one, recorded with a null `newValue`.
 * The session's original abstract at creation is not a revision — nothing
 * changed, the session simply started there.
 */
export function planAbstractRevision(
  prior: string | null | undefined,
  next: string | null | undefined,
): AbstractRevisionPlan | null {
  const priorValue = normalizeAbstract(prior);
  const newValue = normalizeAbstract(next);
  if (priorValue === newValue) return null;
  return { priorValue, newValue };
}

/** What restoring an earlier version writes, and the history it leaves. */
export interface AbstractRestorePlan {
  /** The abstract to write back onto the session. */
  value: string | null;
  /** The row the restore itself appends — a restore is an edit like any
   * other, so it is recorded rather than rewinding the history. */
  revision: AbstractRevisionPlan;
}

/**
 * Restoring an earlier abstract (decisions.md D-071): the value to write and
 * the revision the write leaves behind, or null when the version being
 * restored is already what the session says — nothing to write, and a history
 * row saying an abstract changed to itself would be noise.
 *
 * The history is append-only: the current abstract becomes the new row's
 * `priorValue`, so the version restored *from* is still there to go back to.
 */
export function planAbstractRestore(
  current: string | null | undefined,
  restoreTo: string | null | undefined,
): AbstractRestorePlan | null {
  const revision = planAbstractRevision(current, restoreTo);
  if (!revision) return null;
  return { value: revision.newValue, revision };
}

/** Whether a history entry offers anything to restore — what the panel's
 * Restore button is enabled by. */
export function canRestoreAbstract(
  current: string | null | undefined,
  restoreTo: string | null | undefined,
): boolean {
  return planAbstractRestore(current, restoreTo) !== null;
}

// ---------------------------------------------------------------------------
// History panel presentation
// ---------------------------------------------------------------------------

/** How much of a prior abstract the collapsed history entry shows. */
export const REVISION_PREVIEW_LENGTH = 140;

/** The collapsed preview of a prior value, cut on a word boundary where one
 * is close enough to the limit to look deliberate. */
export function revisionPreview(
  value: string | null,
  limit = REVISION_PREVIEW_LENGTH,
): string {
  if (!value) return "(empty)";
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}
