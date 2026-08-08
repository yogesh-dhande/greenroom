import { notFound } from "next/navigation";
import { getRepos } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";

/** Event overview: a handful of real numbers pulled from the repos, plus a
 * note on what's coming in later waves (review queue, agenda board, etc). */
export default async function EventOverviewPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const [submissions, sessions, speakers, tasks] = await Promise.all([
    repos.submissions.listByEvent(event.id),
    repos.sessions.listByEvent(event.id),
    repos.users.listByRole("speaker"),
    repos.tasks.listByEvent(event.id),
  ]);

  const unreviewed = submissions.filter((s) => s.status === "submitted").length;
  const accepted = submissions.filter((s) => s.status === "approved").length;
  const scheduled = sessions.filter((s) => s.day && s.startTime).length;

  return (
    <div>
      <PageHeader title="Overview" description="Where this event stands right now." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Submissions" value={submissions.length} />
        <StatCard label="Unreviewed" value={unreviewed} sublabel="Awaiting a decision" />
        <StatCard label="Accepted" value={accepted} />
        <StatCard label="Sessions" value={sessions.length} />
        <StatCard label="Scheduled sessions" value={scheduled} sublabel="On the agenda" />
        <StatCard label="Speakers" value={speakers.length} />
        <StatCard label="Tasks" value={tasks.length} sublabel="Onboarding task types" />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>What&apos;s coming next</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This is the Wave 1 shell — routes, navigation, and a shared UI kit.
          Reviewing submissions, building the agenda, sending communications,
          and tracking onboarding all land in later waves.
        </CardContent>
      </Card>
    </div>
  );
}
