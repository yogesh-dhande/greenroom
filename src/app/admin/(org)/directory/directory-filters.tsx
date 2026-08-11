"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DirectoryFilterValues } from "./types";

const ALL = "all";

/**
 * Search + company + tag filters for the contact directory (spec.md
 * "Org-level speaker CRM": attribute filters that compose AND-style and clear
 * in one action), mirroring the event roster's filter bar — the choice lives
 * in the URL and the server does the narrowing, so a filtered directory is
 * bookmarkable, shareable, and exactly what "Save segment" saves.
 *
 * The search box keeps its own state and pushes on a short delay; without
 * that, every keystroke is a server round-trip.
 *
 * The URL is rebuilt from the *resolved* filter rather than edited in place,
 * which is what makes editing a filter while a saved segment is open do the
 * obvious thing: the segment's criteria become explicit `q`/`company`/`tag`
 * params and the `segment` param drops away, so the view stops claiming to
 * be a segment the moment it stops matching one.
 */
export function DirectoryFilters({
  filter,
  companies,
  tags,
  total,
  shown,
}: {
  filter: DirectoryFilterValues;
  /** Distinct companies across the whole directory, not just the shown rows. */
  companies: string[];
  /** Every tag label in use (`listAllLabels`). */
  tags: string[];
  total: number;
  shown: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  // Seeded from the resolved filter, which is why the page remounts this bar
  // (a `key` on the segment) when a saved segment replaces every value: the
  // box has to follow a change it didn't cause, and a remount says that
  // without an effect that writes state on every render.
  const [query, setQuery] = useState(filter.q);
  // Clearing sets the controlled search box and replaces the whole URL in the
  // same click. Without this guard, that state change schedules the debounce
  // once against the previous server-resolved filter and can put company/tag
  // back into the URL before the clear navigation finishes.
  const clearNavigationPending = useRef(false);

  function push(params: URLSearchParams) {
    const search = params.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  }

  function apply(key: keyof DirectoryFilterValues, value: string) {
    const next = new URLSearchParams();
    for (const [name, current] of Object.entries(filter)) {
      if (current) next.set(name, current);
    }
    if (value === ALL || value === "") next.delete(key);
    else next.set(key, value);
    push(next);
  }

  useEffect(() => {
    if (clearNavigationPending.current) {
      const filtersCleared = !filter.q && !filter.company && !filter.tag;
      if (!filtersCleared) return;
      clearNavigationPending.current = false;
    }
    if (query === filter.q) return;
    const timer = setTimeout(() => apply("q", query.trim()), 250);
    return () => clearTimeout(timer);
    // `apply` closes over the resolved filter; re-running on it is what keeps
    // the company/tag choices intact while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter]);

  const filtered = Boolean(filter.q || filter.company || filter.tag);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        id="directory-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name or email"
        aria-label="Search contacts"
        className="h-8 w-64"
      />

      <Select
        value={filter.company || ALL}
        onValueChange={(value) => apply("company", value)}
      >
        <SelectTrigger size="sm" className="w-56" aria-label="Filter by company">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All companies</SelectItem>
          {companies.map((company) => (
            <SelectItem key={company} value={company}>
              {company}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filter.tag || ALL} onValueChange={(value) => apply("tag", value)}>
        <SelectTrigger size="sm" className="w-48" aria-label="Filter by tag">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All tags</SelectItem>
          {tags.map((tag) => (
            <SelectItem key={tag} value={tag}>
              {tag}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearNavigationPending.current = true;
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
        {shown === total ? `${total} contacts` : `${shown} of ${total} contacts`}
      </p>
    </div>
  );
}
