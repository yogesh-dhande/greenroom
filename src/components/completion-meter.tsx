import { cn } from "@/lib/utils";
import { completionPercent, completionSentence, type CompletionWording } from "@/lib/progress";

export interface CompletionMeterProps extends CompletionWording {
  done: number;
  total: number;
  /**
   * Overrides the generated accessible sentence, for a surface that already
   * owns its wording — the review rounds pass `progressLabel` from
   * src/domain/rounds.ts so the meter says exactly what that round's tested
   * label says.
   */
  label?: string;
  /** What a row with no denominator reads instead of an empty bar. */
  emptyLabel?: string;
  className?: string;
}

/**
 * A "done out of total" count as a short bar plus a bare `1/3`.
 *
 * Built for table cells: it fits on one line beside other cell content, and
 * the digits are tabular so a column of fractions stays in a straight edge.
 * The bar and the digits are both `aria-hidden`, with the sentence from
 * src/lib/progress.ts carried in a visually-hidden span, so the meter is read
 * as "1 of 3 tasks complete" rather than "one slash three". The same string
 * is the `title`, which makes it the hover tooltip too.
 *
 * App-level composite rather than a shadcn registry component, so it lives
 * outside src/components/ui — that directory stays exactly what `shadcn add`
 * generated. Colors come from the semantic token set only (decisions.md
 * D-018).
 */
export function CompletionMeter({
  done,
  total,
  noun,
  verb,
  label,
  emptyLabel,
  className,
}: CompletionMeterProps) {
  const sentence = label ?? completionSentence(done, total, { noun, verb });

  // Nothing assigned isn't 0% — it's a different statement, and drawing an
  // empty track for it reads as "none done" when there was never anything to
  // do (the same distinction src/domain/onboarding.ts draws with `no_tasks`).
  if (total <= 0) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {emptyLabel ?? sentence}
      </span>
    );
  }

  const percent = completionPercent(done, total);

  return (
    <span
      title={sentence}
      className={cn("inline-flex items-center gap-2 align-middle", className)}
    >
      <span aria-hidden className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", percent === 100 ? "bg-primary" : "bg-primary/70")}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span aria-hidden className="text-sm tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}
