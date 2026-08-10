/**
 * Serializable view models the Tasks page (a server component) hands to its
 * client islands, following the same rule as the Communications page's
 * types.ts: values the browser needs are declared here rather than imported
 * from a domain module, so no `use client` import chain can drag the
 * repository layer into the browser bundle.
 */

/** A speaker the task dialog can aim a task at (decisions.md D-069). */
export interface TaskSpeakerOption {
  id: string;
  /** Display name, already falling back to the address when unset. */
  name: string;
  email: string;
  /** Effective confirmation — the "confirmed" the all-at-once action targets
   * (decisions.md D-017, D-068): on a session for this event, unless the
   * organizer's stored answer says otherwise. Unconfirmed roster members can
   * still be picked individually; an invited keynote has tasks to do before
   * any session exists. */
  confirmed: boolean;
}
