"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { SubmissionStatus, Track } from "@/db/entities";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALL, STATUS_FILTERS } from "./filters";

/**
 * Search + status-chip + track filters for the review queue (spec.md section
 * 4, wave W25's triage bar). Mirrors the speaker roster's filter bar
 * (speaker-filters.tsx): the choice lives in the URL and the server does the
 * filtering, so a filtered queue is bookmarkable and shareable.
 *
 * The search box keeps its own state and pushes to the URL on a short delay -
 * without that, every keystroke would be a server round-trip.
 *
 * Status is a set of count chips rather than a dropdown: an organizer reads
 * "Unreviewed 6" at a glance, and one click narrows the queue without
 * opening a menu first.
 */
export function SubmissionFilters({
  tracks,
  status,
  track,
  q,
  total,
  shown,
  statusCounts,
  allCount,
}: {
  tracks: Track[];
  status: string;
  track: string;
  q: string;
  total: number;
  shown: number;
  statusCounts: Record<SubmissionStatus, number>;
  allCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(q);

  function push(params: URLSearchParams) {
    const search = params.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  }

  function apply(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === ALL || value === "") next.delete(key);
    else next.set(key, value);
    push(next);
  }

  useEffect(() => {
    if (query === q) return;
    const timer = setTimeout(() => apply("q", query.trim()), 250);
    return () => clearTimeout(timer);
    // `apply` closes over the current params; re-running on those is what
    // keeps the status/track filters intact while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, q, searchParams]);

  const filtered = query !== "" || status !== ALL || track !== ALL;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search title or speaker"
        aria-label="Search submissions"
        className="h-8 w-64"
      />

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
        <Button
          type="button"
          size="sm"
          variant={status === ALL ? "default" : "outline"}
          aria-pressed={status === ALL}
          onClick={() => apply("status", ALL)}
        >
          All {allCount}
        </Button>
        {STATUS_FILTERS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={status === option.value ? "default" : "outline"}
            aria-pressed={status === option.value}
            onClick={() => apply("status", option.value)}
          >
            {option.label} {statusCounts[option.value]}
          </Button>
        ))}
      </div>

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
          onClick={() => {
            setQuery("");
            push(new URLSearchParams());
          }}
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
