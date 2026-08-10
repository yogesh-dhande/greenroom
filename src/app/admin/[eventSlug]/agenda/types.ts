import type { Session } from "@/db/entities";

/** A session plus the speaker ids conflict detection needs — the exact shape
 * `src/domain/scheduling.ts` consumes (spec.md §9). */
export interface BoardSession extends Session {
  speakerIds: string[];
}

/** Just enough of a person to label a card and pick from the directory. */
export interface BoardPerson {
  id: string;
  name: string;
  email: string;
}

/**
 * One abstract revision as the history panel renders it (decisions.md D-071):
 * the author's name and the timestamp are resolved server-side (the board is a
 * client component and has no user lookup), leaving only the prior text for
 * the panel to expand.
 */
export interface SessionRevisionView {
  id: string;
  /** Already resolved to a name, or "Unknown" for a deleted account. */
  authorName: string;
  /** Preformatted in the organizer's locale-independent short form. */
  at: string;
  priorValue: string | null;
}
