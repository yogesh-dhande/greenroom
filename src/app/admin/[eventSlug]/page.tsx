import Link from "next/link";
import { getRepos } from "@/lib/db";
import { requireEventAccess } from "@/lib/session";
import { programVisible } from "@/domain/program-visibility";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { EmbedsCard } from "./embeds-card";
import { ProgramPublishCard } from "./program-publish-card";
import { loadVisibleSubmissions } from "./submissions/queue";

/** Event overview: a handful of real numbers pulled from the repos, plus
 * links into the day-to-day surfaces. */
export default async function EventOverviewPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { user, event } = await requireEventAccess(eventSlug);

  const repos = await getRepos();

  // The same track-scoped predicate the review queue is built from
  // (src/domain/review.ts `visibleSubmissions`, wired through
  // `loadVisibleSubmissions`), not a second copy of it — an admin gets every
  // submission back unfiltered, so this one call covers both roles. Without
  // it these counts (and the "unreviewed"/"accepted" splits below) told a
  // reviewer about drafts, other tracks' talks, and direct-to-session
  // submissions they're barred from ever opening.
  const { submissions } = await loadVisibleSubmissions(repos, event, user);
  const unreviewed = submissions.filter((s) => s.status === "submitted").length;
  const accepted = submissions.filter((s) => s.status === "approved").length;

  // Agenda, Speakers, and Tasks are admin-only surfaces with no track-scoped
  // reading of their own (decisions.md D-047) — sessions, the speaker
  // roster, and onboarding tasks aren't filtered by track anywhere else in
  // the app, so there is no reviewer-safe number to show here. Rather than
  // invent a scoping rule those pages don't have, their stat cards are
  // admin-only too; a reviewer's Overview stops at the submission counts
  // above, same as the "Jump back in" links below.
  let sessionStats: {
    sessions: number;
    scheduled: number;
    speakerCount: number;
    taskCount: number;
  } | null = null;
  if (user.role === "admin") {
    const [sessions, tasks, taskAssignments] = await Promise.all([
      repos.sessions.listByEvent(event.id),
      repos.tasks.listByEvent(event.id),
      repos.taskAssignments.listByEvent(event.id),
    ]);
    const scheduled = sessions.filter((s) => s.day && s.startTime).length;

    // Same "speaker with a stake in this event" definition as the Speakers
    // roster (src/domain/onboarding.ts buildSpeakerRollups via
    // src/app/admin/[eventSlug]/speakers/page.tsx): confirmed to speak (has a
    // session-speaker link) or holding at least one task assignment. Composed
    // from the same repo reads here so the two counts can never disagree
    // (decisions.md D-053).
    const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
      sessions.map((session) => session.id),
    );
    const speakerCount = new Set<string>([
      ...sessionSpeakerRows.map((row) => row.userId),
      ...taskAssignments.map((assignment) => assignment.speakerId),
    ]).size;

    sessionStats = { sessions: sessions.length, scheduled, speakerCount, taskCount: tasks.length };
  }

  return (
    <div>
      <PageHeader title="Overview" description="Where this event stands right now." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Submissions" value={submissions.length} />
        <StatCard label="Unreviewed" value={unreviewed} sublabel="Awaiting a decision" />
        <StatCard label="Accepted" value={accepted} />
        {sessionStats ? (
          <>
            <StatCard label="Sessions" value={sessionStats.sessions} />
            <StatCard
              label="Scheduled sessions"
              value={sessionStats.scheduled}
              sublabel="On the agenda"
            />
            <StatCard label="Speakers" value={sessionStats.speakerCount} />
            <StatCard
              label="Tasks"
              value={sessionStats.taskCount}
              sublabel="Onboarding task types"
            />
          </>
        ) : null}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Jump back in</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {/* Agenda/Speakers/Communications are admin-only (decisions.md
              D-047) — a reviewer's workspace stops at Submissions and Review
              rounds, so offering these would just be a dead end. */}
          <ul className="grid gap-2 sm:grid-cols-2">
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/submissions`}>
                Review submissions
              </Link>{" "}
              — the queue, recommendations, and decisions.
            </li>
            {user.role === "admin" ? (
              <li>
                <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/agenda`}>
                  Build the agenda
                </Link>{" "}
                — drag sessions onto the day/room grid.
              </li>
            ) : null}
            {user.role === "admin" ? (
              <li>
                <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/speakers`}>
                  Track onboarding
                </Link>{" "}
                — who still owes which task.
              </li>
            ) : null}
            {user.role === "admin" ? (
              <li>
                <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/communications`}>
                  Communications
                </Link>{" "}
                — the email log, composer, templates, and invites.
              </li>
            ) : null}
            {user.role === "admin" ? (
              <li>
                <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/communications`}>
                  Send a reminder digest
                </Link>{" "}
                — nudge speakers with outstanding onboarding tasks.
              </li>
            ) : null}
            <li>
              <Link className="text-foreground underline underline-offset-4" href={`/p/${eventSlug}`}>
                Public program
              </Link>{" "}
              {programVisible(event)
                ? "— what attendees see, with embeds."
                : "— not published yet: attendees see a coming-soon page."}
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Publishing is an admin action (decisions.md D-047, D-056); a reviewer
          sees the status through the link caption above and nothing more. */}
      {user.role === "admin" ? (
        <ProgramPublishCard eventSlug={eventSlug} published={programVisible(event)} />
      ) : null}

      {user.role === "admin" ? (
        <EmbedsCard eventSlug={eventSlug} published={programVisible(event)} />
      ) : null}
    </div>
  );
}
