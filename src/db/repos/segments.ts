import type { NewSegment, Segment } from "@/db/entities";

/**
 * Saved directory views (spec.md "Org-level speaker CRM", decisions.md
 * D-077). A segment stores a name and the serialized filter state, never a
 * membership list — reopening one re-runs the query, so a segment always
 * reports its current matches.
 *
 * The repo stores `query` opaquely; validating that it parses back into a
 * `DirectoryFilter` is the domain's job (`parseSegmentQuery` in
 * src/domain/segments.ts), which keeps the shape of a filter out of the
 * storage layer entirely.
 */
export interface SegmentsRepo {
  getById(id: string): Promise<Segment | null>;
  /** Alphabetical by name — the segment list is a menu, not a feed. */
  listAll(): Promise<Segment[]>;
  create(input: NewSegment): Promise<Segment>;
  delete(id: string): Promise<void>;
}
