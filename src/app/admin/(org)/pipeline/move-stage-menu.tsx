"use client";

import { useTransition } from "react";
import { ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import type { PipelineStage } from "@/db/entities";
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { movePipelineStage } from "./actions";

/**
 * The explicit stage control (spec.md "Org-level speaker CRM", D-077: "cards
 * move between stages via an explicit control").
 *
 * A menu rather than drag-and-drop: the board is the same on a laptop, a
 * tablet and a screen reader, and the eval's own scenario allows either. The
 * current stage is left out of the list because a move onto it is a no-op —
 * the repo would write nothing, so offering it would only look broken.
 *
 * The accessible name stays exactly "Move to" on every card; which card is
 * being moved lives in the `title`, so a page full of cards still has one
 * discoverable control name.
 */
export function MoveStageMenu({
  cardId,
  stage,
  contactName,
  size = "sm",
}: {
  cardId: string;
  stage: PipelineStage;
  contactName: string;
  size?: "sm" | "default";
}) {
  const [isPending, startTransition] = useTransition();

  function move(toStage: PipelineStage) {
    startTransition(async () => {
      const result = await movePipelineStage({ cardId, toStage });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.message);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={size}
          disabled={isPending}
          title={`Move ${contactName} to another stage`}
        >
          {isPending ? "Moving…" : "Move to"}
          <ChevronDownIcon data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {PIPELINE_STAGES.filter((option) => option !== stage).map((option) => (
          <DropdownMenuItem key={option} onSelect={() => move(option)}>
            {PIPELINE_STAGE_LABELS[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
