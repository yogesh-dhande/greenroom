import Link from "next/link";
import { getRepos } from "@/lib/db";
import { requireEventAccess } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";

/** Event overview: a handful of real numbers pulled from the repos, plus
 * links into the day-to-day surfaces. */
export default async function EventOverviewPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { event } = await requireEventAccess(eventSlug);

  const repos = await getRepos();
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
          <CardTitle>Jump back in</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="grid gap-2 sm:grid-cols-2">
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/submissions`}>
                Review submissions
              </Link>{" "}
              — the queue, recommendations, and decisions.
            </li>
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/agenda`}>
                Build the agenda
              </Link>{" "}
              — drag sessions onto the day/room grid.
            </li>
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/speakers`}>
                Track onboarding
              </Link>{" "}
              — who still owes which task.
            </li>
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/communications`}>
                Communications
              </Link>{" "}
              — the email log, composer, templates, and invites.
            </li>
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/p/${eventSlug}`}>
                Public program
              </Link>{" "}
              — what attendees see, with embeds.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
