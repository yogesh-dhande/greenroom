/**
 * How a "done out of total" count is put into words.
 *
 * The same fraction is printed on the speaker roster, a speaker's record, the
 * review rounds list, a reviewer's queue and the speaker portal. Drawn as a
 * bar plus a bare `1/3`, the number is fast to scan but says nothing out
 * loud — a screen reader would read "one slash three" — so every meter
 * carries the sentence below as its accessible name, and it is written once
 * here rather than per surface.
 */

export interface CompletionWording {
  /** Singular noun for the thing being counted — "task", "submission". */
  noun?: string;
  /** Past participle that finishes the sentence — "complete", "scored". */
  verb?: string;
}

const DEFAULT_NOUN = "task";
const DEFAULT_VERB = "complete";

/**
 * The filled share of the bar, 0-100 and rounded.
 *
 * An empty denominator is 0 rather than 100: there is no progress to draw
 * when nothing was ever assigned, and the surfaces that want "nothing
 * outstanding is fine" say so in words instead (see `CompletionMeter`'s
 * `emptyLabel`). Out-of-range counts clamp rather than overflow the track.
 */
export function completionPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(Math.min(Math.max(done / total, 0), 1) * 100);
}

/**
 * "1 of 3 tasks complete" — what the meter is called for anyone who can't
 * see it. The noun agrees with the total ("1 of 1 task complete"), and a
 * total of zero has no fraction to state at all ("No tasks").
 */
export function completionSentence(
  done: number,
  total: number,
  wording: CompletionWording = {},
): string {
  const noun = wording.noun ?? DEFAULT_NOUN;
  const verb = wording.verb ?? DEFAULT_VERB;
  const plural = `${noun}s`;
  if (total <= 0) return `No ${plural}`;
  return `${done} of ${total} ${total === 1 ? noun : plural} ${verb}`;
}
