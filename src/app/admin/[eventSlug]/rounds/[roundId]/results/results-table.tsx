"use client";

import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import {
  roundScoreValue,
  sortResultRows,
  type ResultRow,
  type ResultSortKey,
  type SortDirection,
} from "@/domain/rounds";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The organizer's results table (rubric ABS-10): one row per submission with
 * the round's aggregate score, sortable by it. Sorting is client-side because
 * a round's submission list is a page-sized thing an organizer wants to flip
 * between orderings instantly.
 */
function SortButton({
  label,
  sortBy,
  sortKey,
  direction,
  onToggle,
}: {
  label: string;
  sortBy: ResultSortKey;
  sortKey: ResultSortKey;
  direction: SortDirection;
  onToggle: (key: ResultSortKey) => void;
}) {
  const active = sortKey === sortBy;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortBy)}
      aria-label={`Sort by ${label}`}
      className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        )
      ) : null}
    </button>
  );
}

export function ResultsTable({ rows }: { rows: ResultRow[] }) {
  const [sortKey, setSortKey] = useState<ResultSortKey>("score");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const sorted = useMemo(
    () => sortResultRows(rows, sortKey, direction),
    [rows, sortKey, direction],
  );

  function toggle(key: ResultSortKey) {
    if (key === sortKey) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection(key === "title" ? "asc" : "desc");
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortButton
              label="Submission"
              sortBy="title"
              sortKey={sortKey}
              direction={direction}
              onToggle={toggle}
            />
          </TableHead>
          <TableHead>Speakers</TableHead>
          <TableHead>Tracks</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <SortButton
              label="Scorecards"
              sortBy="scored"
              sortKey={sortKey}
              direction={direction}
              onToggle={toggle}
            />
          </TableHead>
          <TableHead className="text-right">
            <SortButton
              label="Aggregate score"
              sortBy="score"
              sortKey={sortKey}
              direction={direction}
              onToggle={toggle}
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.submissionId} data-testid="result-row">
            <TableCell className="font-medium text-foreground">{row.title}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.speakers.join(", ") || "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.trackNames.join(", ") || "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{row.status}</TableCell>
            <TableCell className="text-sm tabular-nums text-muted-foreground">
              {row.summary.scored} of {row.summary.required}
            </TableCell>
            <TableCell className="text-right tabular-nums font-medium text-foreground">
              {row.summary.score === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                roundScoreValue(row.summary.score)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
