import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** `attention` marks a number that stands for work somebody owes — an
 * unreviewed queue, an overdue task, a clash on the agenda. Everything else
 * is `default`: a fact about the event, not a nudge. */
export type StatCardTone = "default" | "attention";

export interface StatCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  /**
   * The filtered destination this number stands for. Given one, the whole
   * card becomes a single link — one tab stop, one hit target, and the
   * number itself is what you click, rather than a separate "view all".
   */
  href?: string;
  /** See `StatCardTone`. Defaults to `default`. */
  tone?: StatCardTone;
  /**
   * The supportive line an `attention` card shows at zero, in place of
   * `sublabel`. Zero overdue tasks is good news, so it reads as good news.
   */
  clearLabel?: string;
}

/** Single number with a label — the building block of the event overview.
 * Composed from shadcn's Card primitives so spacing/radius/colors all come
 * from the token set.
 *
 * An `attention` card is loud only while there is something to be loud
 * about: the number takes the semantic `warning` token (decisions.md D-018 —
 * never a raw amber class) while it is non-zero, and goes quiet with a
 * "nothing outstanding" hint the moment the work is cleared. A permanently
 * amber "0 overdue" would train an organizer to stop seeing the color. */
export function StatCard({
  label,
  value,
  sublabel,
  href,
  tone = "default",
  clearLabel = "All clear",
}: StatCardProps) {
  // String values come from callers that pre-format a count; either way,
  // "no work outstanding" is the case that flips an attention card quiet.
  const cleared = tone === "attention" && (value === 0 || value === "0");
  const alerting = tone === "attention" && !cleared;
  const caption = cleared ? clearLabel : sublabel;

  const card = (
    <Card
      className={cn(
        "gap-2 py-4",
        // Only the linked cards get a hover affordance — a card that doesn't
        // go anywhere shouldn't imply that it does.
        href && "h-full transition-colors group-hover/stat:bg-accent/40 group-hover/stat:ring-foreground/20",
      )}
    >
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums tracking-tight",
            alerting ? "text-warning" : cleared ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {value}
        </p>
        {caption && <CardDescription className="mt-1">{caption}</CardDescription>}
      </CardContent>
    </Card>
  );

  if (!href) return card;

  return (
    <Link
      href={href}
      className="group/stat block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {card}
    </Link>
  );
}
