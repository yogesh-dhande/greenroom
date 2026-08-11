import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DirectoryContact, DirectoryFilter } from "@/db/repos/contacts";
import type { MergeData } from "@/domain/comms-templates";
import {
  contactDisplayName,
  filterDirectory,
  isEmptyDirectoryFilter,
  normalizeContactNameKey,
  normalizeDirectoryFilter,
} from "@/domain/crm";
import { PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { segmentFilterOrEmpty } from "@/domain/segments";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddContactDialog } from "./add-contact-dialog";
import { DirectoryFilters } from "./directory-filters";
import { DirectoryTable } from "./directory-table";
import { describeDirectoryFilter } from "./filter-summary";
import { ImportContactsDialog } from "./import-contacts-dialog";
import { orgPortalUrl } from "./org-merge-fields";
import { SaveSegmentDialog } from "./save-segment-dialog";
import type { DirectoryRow, SegmentRow } from "./types";

const DIRECTORY_PATH = "/admin/directory";

/**
 * Display names shared by two or more contacts (decisions.md D-059).
 *
 * Computed against the whole directory rather than the filtered rows, so a
 * collision doesn't vanish just because a filter hides the other record.
 * Flag only — merging stays out of scope (D-065), and the badge's title names
 * the addresses so the guard is actionable without opening either profile.
 */
function duplicateNamesByUser(contacts: readonly DirectoryContact[]): Map<string, string> {
  const byName = new Map<string, DirectoryContact[]>();
  for (const contact of contacts) {
    const key = normalizeContactNameKey(contact.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), contact]);
  }

  const titles = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const contact of group) {
      const others = group.filter((other) => other.userId !== contact.userId);
      titles.set(
        contact.userId,
        `Another contact uses the same name (${others.map((other) => other.email).join(", ")})`,
      );
    }
  }
  return titles;
}

/** Distinct companies across the directory, case-insensitively grouped and
 * displayed with the first spelling seen — the same rule `topCompanies` uses,
 * so the CRM overview's widget links to a company this list also offers. */
function distinctCompanies(contacts: readonly DirectoryContact[]): string[] {
  const byKey = new Map<string, string>();
  for (const contact of contacts) {
    const company = contact.company?.trim();
    if (!company) continue;
    const key = company.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, company);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * The org-level contact directory (spec.md "Org-level speaker CRM",
 * decisions.md D-077): every speaker across every event, plus contacts added
 * by hand or imported, in one searchable table that exists outside any single
 * event.
 *
 * Filters live in the URL and are applied by the datastore
 * (`listDirectory(filter)`), so the view is bookmarkable and a large directory
 * is narrowed by the database rather than in memory. The unfiltered read is
 * still made once alongside it — the counts ("N of M"), the company options,
 * the duplicate flags and the segments' live member counts are all statements
 * about the *whole* directory, and each would otherwise be a separate query.
 *
 * Admin-only (roles are global, D-025). The (org) layout guards too; this is
 * the page's own guard, not defence in depth borrowed from it.
 */
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; company?: string; tag?: string; segment?: string }>;
}) {
  const { q = "", company = "", tag = "", segment: segmentId } = await searchParams;
  const viewer = await requireAdmin(DIRECTORY_PATH);

  const repos = await getRepos();

  // A saved segment *replaces* the explicit params rather than combining with
  // them: it is a stored filter, and two filters at once would show something
  // neither the segment nor the URL promised.
  const activeSegment = segmentId ? await repos.segments.getById(segmentId) : null;
  const filter: DirectoryFilter = activeSegment
    ? segmentFilterOrEmpty(activeSegment.query)
    : normalizeDirectoryFilter({ q, company, tag });
  const narrowed = !isEmptyDirectoryFilter(filter);

  const [allContacts, tagLabels, segments] = await Promise.all([
    repos.contacts.listDirectory(),
    repos.contacts.listAllLabels(),
    repos.segments.listAll(),
  ]);
  const contacts = narrowed ? await repos.contacts.listDirectory(filter) : allContacts;

  const cards = await repos.pipeline.listCardsByUsers(contacts.map((contact) => contact.userId));
  const stageByUser = new Map(cards.map((card) => [card.userId, card.stage]));
  const duplicateTitles = duplicateNamesByUser(allContacts);

  const rows: DirectoryRow[] = contacts.map((contact) => {
    const stage = stageByUser.get(contact.userId);
    return {
      userId: contact.userId,
      displayName: contactDisplayName(contact),
      name: contact.name,
      email: contact.email,
      title: contact.title,
      company: contact.company,
      tags: contact.tags,
      eventCount: contact.eventCount,
      stageLabel: stage ? PIPELINE_STAGE_LABELS[stage] : null,
      duplicate: duplicateTitles.has(contact.userId),
      duplicateWith: duplicateTitles.get(contact.userId) ?? "",
    };
  });

  // Segments are dynamic (spec.md), so the count beside each one is taken
  // now, over the same predicate the datastore applies — never a stored
  // membership list.
  const segmentRows: SegmentRow[] = segments.map((saved) => {
    const savedFilter = segmentFilterOrEmpty(saved.query);
    return {
      id: saved.id,
      name: saved.name,
      criteria: describeDirectoryFilter(savedFilter),
      memberCount: filterDirectory(allContacts, savedFilter).length,
    };
  });

  // The bulk composer's preview resolves against the same organizer/portal
  // values `sendDirectoryEmail` will fill in, so what an organizer sees on
  // screen is what recipients get. Read here rather than imported from the
  // send path: nothing a client island touches may pull src/domain/comms
  // (learnings.md, "A `use client` import chain can pull the email transport
  // into the browser bundle"). Same precedence as `getCommsContext`.
  const { env } = await getCloudflareContext({ async: true });
  const orgFields: MergeData = {
    organizerName: viewer.name?.trim() || viewer.email,
    organizerEmail: viewer.email,
    portalUrl: orgPortalUrl(env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000"),
  };

  return (
    <div>
      <PageHeader
        title="Directory"
        description="Every speaker across your events, plus contacts you've added yourself."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SaveSegmentDialog
              filter={{ q: filter.q ?? "", company: filter.company ?? "", tag: filter.tag ?? "" }}
              criteria={describeDirectoryFilter(filter)}
              matchCount={contacts.length}
            />
            <ImportContactsDialog />
            <AddContactDialog
              duplicateCandidates={allContacts.map(({ userId, name, email }) => ({
                userId,
                name,
                email,
              }))}
            />
          </div>
        }
      />

      {segmentId && !activeSegment ? (
        <p className="mb-4 rounded-md border border-warning bg-warning/10 p-3 text-sm text-warning">
          That saved segment no longer exists — showing the whole directory.
        </p>
      ) : null}

      {activeSegment ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
          <Badge variant="outline">Segment</Badge>
          <span className="text-sm font-medium text-foreground">{activeSegment.name}</span>
          <span className="text-sm text-muted-foreground">
            {describeDirectoryFilter(filter)}
          </span>
          <Link
            href={DIRECTORY_PATH}
            className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Clear segment
          </Link>
        </div>
      ) : null}

      {segmentRows.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Segments</CardTitle>
            <CardDescription>
              Saved filters, not saved lists — each one re-runs when you open it, so its members
              are always current.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {segmentRows.map((saved) => (
                <li key={saved.id} className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`${DIRECTORY_PATH}?segment=${saved.id}`}
                    className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {saved.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{saved.criteria}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {saved.memberCount} {saved.memberCount === 1 ? "contact" : "contacts"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {allContacts.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          description="Anyone who speaks at one of your events shows up here automatically. You can also add a contact by hand or import a CSV."
        />
      ) : (
        <>
          <DirectoryFilters
            // Opening or clearing a saved segment rewrites every value from
            // the server; remounting is how the search box picks up a change
            // it didn't cause.
            key={activeSegment?.id ?? "explicit"}
            filter={{ q: filter.q ?? "", company: filter.company ?? "", tag: filter.tag ?? "" }}
            companies={distinctCompanies(allContacts)}
            tags={tagLabels}
            total={allContacts.length}
            shown={contacts.length}
          />

          {rows.length === 0 ? (
            <EmptyState
              title="Nobody matches those filters"
              description="Try a different search, company, or tag — or clear the filters to see everyone."
            />
          ) : (
            <DirectoryTable rows={rows} orgFields={orgFields} />
          )}
        </>
      )}
    </div>
  );
}
