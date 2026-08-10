"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import type { PipelineStage } from "@/db/entities";
import {
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
  PIPELINE_VIEW_TABLE,
} from "@/domain/pipeline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

/**
 * The table view's stage filter and count (spec.md "Org-level speaker CRM",
 * decisions.md D-077).
 *
 * Same shape as the directory's filter bar — the choice lives in the URL and
 * the server does the narrowing — so a filtered outreach list is bookmarkable
 * and shareable, and the CRM's two lists are filtered the same way. The `view`
 * parameter is rewritten alongside it: picking a stage must never quietly
 * bounce the organizer back to the board.
 */
export function PipelineFilters({
  stage,
  total,
  shown,
}: {
  stage: PipelineStage | null;
  /** Prospects on the board, before the stage filter. */
  total: number;
  shown: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function apply(value: string) {
    const params = new URLSearchParams({ view: PIPELINE_VIEW_TABLE });
    if (value !== ALL) params.set("stage", value);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select value={stage ?? ALL} onValueChange={apply}>
        <SelectTrigger size="sm" className="w-48" aria-label="Filter by stage">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All stages</SelectItem>
          {PIPELINE_STAGES.map((option) => (
            <SelectItem key={option} value={option}>
              {PIPELINE_STAGE_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p
        className="ml-auto text-sm text-muted-foreground"
        aria-live="polite"
        data-pending={isPending ? "" : undefined}
      >
        {shown === total ? `${total} prospects` : `${shown} of ${total} prospects`}
      </p>
    </div>
  );
}
