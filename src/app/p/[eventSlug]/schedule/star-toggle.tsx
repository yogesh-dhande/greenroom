"use client";

import { StarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The add/remove control for the personal itinerary (spec.md "Public program
 * depth"). `aria-pressed` carries the state rather than only the fill colour,
 * and the accessible name names the talk — a schedule holds a dozen of these
 * and "Add to my schedule" twelve times over is unusable with a screen reader
 * (and ambiguous for an automated click).
 */
export function StarToggle({
  starred,
  title,
  onToggle,
  withLabel = false,
  className,
}: {
  starred: boolean;
  title: string;
  onToggle: () => void;
  withLabel?: boolean;
  className?: string;
}) {
  const action = starred ? "Remove from my schedule" : "Add to my schedule";
  return (
    <Button
      type="button"
      variant={withLabel ? "outline" : "ghost"}
      size={withLabel ? "default" : "icon-sm"}
      aria-pressed={starred}
      aria-label={`${action}: ${title}`}
      title={action}
      onClick={(clickEvent) => {
        // Schedule cards are click-through-to-detail; starring must not also
        // open the dialog behind this button.
        clickEvent.stopPropagation();
        onToggle();
      }}
      className={cn(starred && "text-primary", className)}
    >
      <StarIcon className={cn(starred && "fill-current")} aria-hidden />
      {withLabel && action}
    </Button>
  );
}
