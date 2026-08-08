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
