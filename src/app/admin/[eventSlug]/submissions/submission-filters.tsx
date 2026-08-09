"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { Track } from "@/db/entities";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ALL, STATUS_FILTERS } from "./filters";

/**
 * Status/track filters for the review queue (spec.md §4 — "admin submission
 * list with clear statuses"; filters are the "important" tier).
 *
 * The choice lives in the URL rather than component state: an organizer can
 * bookmark "everything unreviewed in my track" and send it to a colleague, and
 * the server does the filtering so a long queue never ships rows the viewer
 * isn't looking at.
 */
export function SubmissionFilters({
  tracks,
  status,
  track,
  total,
  shown,
}: {
  tracks: Track[];
  status: string;
  track: string;
  total: number;
  shown: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function apply(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  const filtered = status !== ALL || track !== ALL;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select value={status} onValueChange={(value) => apply("status", value)}>
        <SelectTrigger size="sm" className="w-44" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {STATUS_FILTERS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={track} onValueChange={(value) => apply("track", value)}>
        <SelectTrigger size="sm" className="w-52" aria-label="Filter by track">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All tracks</SelectItem>
          {tracks.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => startTransition(() => router.replace(pathname))}
        >
          Clear filters
        </Button>
      )}

      <p
        className="ml-auto text-sm text-muted-foreground"
        aria-live="polite"
        data-pending={isPending ? "" : undefined}
      >
        {shown === total ? `${total} submissions` : `${shown} of ${total} submissions`}
      </p>
    </div>
  );
}
