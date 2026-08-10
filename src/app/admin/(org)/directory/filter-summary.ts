/**
 * Directory criteria in the words an organizer would use.
 *
 * A saved segment is only trustworthy if its criteria are legible without
 * opening it (spec.md "Org-level speaker CRM"), and the serialized query
 * (`{"company":"Northwind","tag":"ai"}`) is not that. Pure, so the segments
 * panel, the active-segment chip and the save dialog all describe a filter
 * the same way.
 */
import type { DirectoryFilter } from "@/db/repos/contacts";
import { normalizeDirectoryFilter } from "@/domain/crm";

/** "Search 'priya' · company contains Northwind · tagged ai", or a plain
 * "Everyone" when nothing narrows. */
export function describeDirectoryFilter(filter: DirectoryFilter | undefined): string {
  const { q, company, tag } = normalizeDirectoryFilter(filter);
  const parts: string[] = [];
  if (q) parts.push(`search "${q}"`);
  if (company) parts.push(`company contains "${company}"`);
  if (tag) parts.push(`tagged "${tag}"`);
  if (parts.length === 0) return "Everyone in the directory";
  return parts.join(" · ");
}
