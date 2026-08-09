"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ROSTER_STATUS_FILTERS } from "@/domain/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

/**
 * Search + completion filters for the speaker roster (decisions.md D-051),
 * mirroring the submissions queue: the choice lives in the URL and the server
 * does the filtering, so a filtered roster is bookmarkable and shareable.
 *
 * The search box keeps its own state and pushes to the URL on a short delay —
 * without that, every keystroke would be a server round-trip.
 */
export function SpeakerFilters({
  q,
  status,
  total,
  shown,
}: {
  q: string;
  status: string;
  total: number;
  shown: number;
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
    // keeps the status filter intact while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, q, searchParams]);

  const filtered = query !== "" || status !== ALL;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, email, or company"
        aria-label="Search speakers"
        className="h-8 w-64"
      />

      <Select value={status} onValueChange={(value) => apply("status", value)}>
        <SelectTrigger size="sm" className="w-48" aria-label="Filter by task completion">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All speakers</SelectItem>
          {ROSTER_STATUS_FILTERS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
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
        {shown === total ? `${total} speakers` : `${shown} of ${total} speakers`}
      </p>
    </div>
  );
}
