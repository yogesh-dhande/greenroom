/**
 * The publish gate for every attendee-facing program surface (decisions.md
 * D-056). Kept as its own tiny module — not a boolean read scattered through
 * the loaders — so a new public surface has one obvious call to make, and so
 * "is the program live?" has a single definition to change.
 *
 * Deliberately narrow: this answers only whether the *program* (schedule,
 * speaker gallery, embeds, feeds) is public. The CFP form has its own
 * open/close window (src/domain/forms.ts `formWindowState`) and is never
 * gated by this flag — a call for speakers routinely runs months before the
 * schedule is announced.
 */
import type { Event } from "@/db/entities";

export function programVisible(event: Pick<Event, "programPublished">): boolean {
  return event.programPublished;
}
