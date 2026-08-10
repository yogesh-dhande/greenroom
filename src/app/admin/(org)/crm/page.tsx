import Link from "next/link";
import { computeCrmKpis } from "@/domain/crm";
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The CRM overview (spec.md "Org-level speaker CRM", decisions.md D-077):
 * org-wide KPIs plus the two widgets that lead somewhere — stage counts into
 * the sourcing board, top companies into the directory filtered to that
 * company.
 *
 * Every number comes from `computeCrmKpis`, which reads the same three lists
 * the directory and board render, so the overview can never quietly disagree
 * with the pages it summarizes. The event count is `events.listAll().length`
 * rather than anything derived from contacts, so a brand-new event with no
 * speakers still counts.
 */
export default async function CrmOverviewPage() {
  await requireAdmin("/admin/crm");
  const repos = await getRepos();

  const [contacts, cards, events] = await Promise.all([
    repos.contacts.listDirectory(),
    repos.pipeline.listCards(),
    repos.events.listAll(),
  ]);

  const kpis = computeCrmKpis({ contacts, totalEvents: events.length, cards });

  return (
    <div>
      <PageHeader
        title="Speaker CRM overview"
        description="Everyone the organization knows, across every event."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* None of these is work anybody owes — they describe the org, they
            don't ask for anything — so they stay in the default tone and only
            gain the link into the surface each number is counted from. */}
        <StatCard label="Total contacts" value={kpis.totalContacts} href="/admin/directory" />
        <StatCard label="Events" value={kpis.totalEvents} href="/admin" />
        <StatCard
          label="Returning speakers"
          value={kpis.returningSpeakers}
          sublabel="on 2+ events"
        />
        <StatCard
          label="In pipeline"
          value={kpis.pipelineTotal}
          sublabel={`${kpis.pipelineByStage.confirmed} confirmed`}
          href="/admin/pipeline"
        />
      </div>

      {kpis.totalContacts === 0 ? (
        <EmptyState
          className="mt-6"
          title="No contacts yet"
          description="Add or import contacts in the directory and this overview fills in — speakers on any event count automatically."
          action={
            <Button asChild size="sm">
              <Link href="/admin/directory">Open directory</Link>
            </Button>
          }
        />
      ) : (
        <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pipeline by stage
              </CardTitle>
              <CardDescription>Prospective speakers on the sourcing board.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col">
                {PIPELINE_STAGES.map((stage) => (
                  <li key={stage}>
                    <Link
                      href="/admin/pipeline"
                      className="flex items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-muted"
                    >
                      <span className="text-foreground">{PIPELINE_STAGE_LABELS[stage]}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {kpis.pipelineByStage[stage]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Top companies
              </CardTitle>
              <CardDescription>Where the contact list is concentrated.</CardDescription>
            </CardHeader>
            <CardContent>
              {kpis.topCompanies.length === 0 ? (
                <EmptyState variant="inline" title="No contact has a company recorded yet." />
              ) : (
                <ul className="flex flex-col">
                  {kpis.topCompanies.map((entry) => (
                    <li key={entry.company}>
                      <Link
                        href={`/admin/directory?company=${encodeURIComponent(entry.company)}`}
                        className="flex items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-muted"
                      >
                        <span className="truncate text-foreground">{entry.company}</span>
                        <span className="tabular-nums text-muted-foreground">{entry.count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
