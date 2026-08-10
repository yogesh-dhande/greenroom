/**
 * Saved directory segments (spec.md "Org-level speaker CRM", decisions.md
 * D-077): the (de)serialization of a directory filter to and from the string
 * stored in `segments.query`.
 *
 * A segment is dynamic — it stores the *question*, not the answer — so this
 * module is the contract between a filter bar today and the same filter bar
 * after a redeploy. Parsing is therefore strict about keys: a query naming
 * something the directory no longer filters on is reported rather than
 * silently ignored, because silently ignoring it would reopen the segment
 * showing more contacts than its name promises.
 */
import type { DirectoryFilter } from "@/db/repos/contacts";
import { normalizeDirectoryFilter } from "@/domain/crm";

/**
 * Every key a serialized segment query may carry. Adding a filter means adding
 * it here *and* to `DirectoryFilter`; the type assertion below fails to
 * compile if the two ever disagree.
 */
export const SEGMENT_QUERY_KEYS = ["q", "company", "tag"] as const;
export type SegmentQueryKey = (typeof SEGMENT_QUERY_KEYS)[number];

// Compile-time guard: the key list is exactly the filter's own key set.
type AssertSameKeys = SegmentQueryKey extends keyof DirectoryFilter
  ? keyof DirectoryFilter extends SegmentQueryKey
    ? true
    : never
  : never;
const _keysMatch: AssertSameKeys = true;
void _keysMatch;

export type SegmentQueryResult =
  | { ok: true; filter: DirectoryFilter }
  | { ok: false; error: string };

/**
 * Serializes a filter to the stored form: normalized first, so two filter bars
 * that mean the same thing produce the same string, and keys in a fixed order
 * so the string is comparable byte-for-byte.
 */
export function serializeSegmentQuery(filter: DirectoryFilter | undefined): string {
  const normalized = normalizeDirectoryFilter(filter);
  const ordered: Record<string, string> = {};
  for (const key of SEGMENT_QUERY_KEYS) {
    const value = normalized[key];
    if (value) ordered[key] = value;
  }
  return JSON.stringify(ordered);
}

/**
 * Parses a stored query back into a filter, rejecting anything that isn't one.
 *
 * Three failures are reported rather than swallowed: malformed JSON, a payload
 * that isn't a plain object, and unknown or wrongly-typed keys. All three mean
 * the same thing to an organizer — "this saved view can't be trusted to show
 * what its name says" — and a segment that quietly widened itself is the worst
 * possible answer.
 */
export function parseSegmentQuery(raw: string): SegmentQueryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Saved filter is not valid JSON." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Saved filter is not a filter object." };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  const known = new Set<string>(SEGMENT_QUERY_KEYS);
  const unknown = entries.map(([key]) => key).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Saved filter uses unknown field${unknown.length > 1 ? "s" : ""}: ${unknown
        .sort()
        .join(", ")}.`,
    };
  }

  const filter: DirectoryFilter = {};
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") {
      return { ok: false, error: `Saved filter field "${key}" is not text.` };
    }
    filter[key as SegmentQueryKey] = value;
  }

  return { ok: true, filter: normalizeDirectoryFilter(filter) };
}

/**
 * A segment's filter, or an empty one when the stored query is unreadable.
 *
 * For read-only surfaces (a segment list showing match counts) where one bad
 * row must not take the page down. Anything that *acts* on the filter should
 * call `parseSegmentQuery` and show the error instead.
 */
export function segmentFilterOrEmpty(raw: string): DirectoryFilter {
  const result = parseSegmentQuery(raw);
  return result.ok ? result.filter : {};
}

/** Trimmed segment name, or null when the organizer typed nothing usable. */
export function normalizeSegmentName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  return name === "" ? null : name;
}
