import Link from "next/link";
import type { PipelineStage } from "@/db/entities";
import { formatPipelineScore, PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { formatRelativeTime } from "@/lib/event-time";
import { formatDate } from "@/components/date-format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MoveStageMenu } from "./move-stage-menu";

/** One prospect as the table reads them; the board renders the same values. */
export interface ProspectRow {
  cardId: string;
  userId: string;
  name: string;
  company: string | null;
  score: number | null;
  stage: PipelineStage;
  /** Newest stage event, or the enrolment date when nothing has moved since. */
  lastTouchedAt: Date;
}

/**
 * The sourcing pipeline as a list (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * Same data as the board, second shape: a board is for looking at the funnel,
 * a table is for doing an outreach pass. Rows are the directory's row
 * treatment exactly — same table primitives, same whole-row link to the
 * contact profile — so the CRM's two lists read as one product rather than as
 * two screens that happen to list people.
 *
 * Stalest first, ordered by the caller (`sortByLastTouch`): the question this
 * view answers is "who has nobody spoken to in a while?", so the answer is at
 * the top and the header carries `aria-sort` to say so. `now` is a prop rather
 * than a `Date.now()` in here so the whole table is one server-rendered
 * instant — every row's "34d ago" is measured from the same clock reading.
 */
export function PipelineTable({ rows, now }: { rows: ProspectRow[]; now: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Contact</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Score</TableHead>
          <TableHead aria-sort="ascending">Last touch</TableHead>
          <TableHead>Move to</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.cardId} className="relative">
            <TableCell>
              {/* Whole-row click target, the same pattern the directory table
                  uses: the name link's overlay pseudo-element stretches across
                  the positioned row, so a pointer anywhere on the row opens
                  the profile while the accessible name and the real href stay
                  on the name. */}
              <Link
                href={`/admin/directory/${row.userId}`}
                className="font-medium text-foreground underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {row.name}
              </Link>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{row.company ?? "—"}</TableCell>
            <TableCell>
              <Badge variant="outline">{PIPELINE_STAGE_LABELS[row.stage]}</Badge>
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {formatPipelineScore(row.score)}
            </TableCell>
            <TableCell
              className="tabular-nums text-muted-foreground"
              title={formatDate(row.lastTouchedAt)}
            >
              {formatRelativeTime(now, row.lastTouchedAt.getTime(), {
                // No calendar fallback here: a stale prospect's whole point is
                // *how* stale, and "34d ago" says that where "Jul 5" doesn't.
                horizonMs: Number.POSITIVE_INFINITY,
              })}
            </TableCell>
            <TableCell>
              {/* Above the row-wide link overlay, or the menu would be
                  unclickable — moving a prospect must not also open them. */}
              <span className="relative z-10 flex">
                <MoveStageMenu cardId={row.cardId} stage={row.stage} contactName={row.name} />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
