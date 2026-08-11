import Link from "next/link";
import { getRepos } from "@/lib/db";
import { requireEventAccess } from "@/lib/session";
import { buildAssignmentViews, rosterSpeakerIds } from "@/domain/onboarding";
import { programVisible } from "@/domain/program-visibility";
import { detectConflicts } from "@/domain/scheduling";
import { QUEUE_VIEW_ALL } from "@/domain/review";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { EmbedsCard } from "./embeds-card";
import { ProgramPublishCard } from "./program-publish-card";
import { VIEW_PARAM } from "./submissions/filters";
import { loadVisibleSubmissions } from "./submissions/queue";

/** Event overview: a handful of real numbers pulled from the repos, plus
 * links into the day-to-day surfaces.
 *
 * Every card is a link to the list its number was counted from, and the four
 * that stand for work somebody owes — unreviewed submissions, unscheduled
 * sessions, agenda conflicts, overdue tasks — carry the `attention` tone, so
 * the page reads as a to-do list while there is anything to do and goes quiet
 * once there isn't. */
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
    unscheduled: number;
    conflicts: number;
    speakerCount: number;
    taskCount: number;
    overdueTasks: number;
  } | null = null;
  if (user.role === "admin") {
    const [sessions, tasks, taskAssignments, eventSpeakers] = await Promise.all([
      repos.sessions.listByEvent(event.id),
      repos.tasks.listByEvent(event.id),
      repos.taskAssignments.listByEvent(event.id),
      repos.eventSpeakers.listByEvent(event.id),
    ]);
    const unscheduled = sessions.filter((s) => !s.day || !s.startTime).length;

    // Same "speaker with a stake in this event" definition as the Speakers
    // roster, through the roster's own union (src/domain/onboarding.ts
    // `rosterSpeakerIds`, used by src/app/admin/[eventSlug]/speakers/roster.ts)
    // rather than a second copy of it: all three membership sources, including
    // the `event_speakers` rows a manually added or imported speaker has and
    // nothing else (decisions.md D-051, D-053) — without them the roster listed
    // a speaker this card counted as zero.
    const sessionSpeakerRows = await repos.sessions.listSpeakersBySessionIds(
      sessions.map((session) => session.id),
    );
    const speakerCount = rosterSpeakerIds({
      confirmedSpeakerIds: sessionSpeakerRows.map((row) => row.userId),
      assignedSpeakerIds: taskAssignments.map((assignment) => assignment.speakerId),
      memberSpeakerIds: eventSpeakers.map((member) => member.userId),
    }).size;

    // The agenda's own conflict detector (src/domain/scheduling.ts), run on
    // the same session-plus-speakers shape the board builds — the overview
    // counts what the agenda would draw a warning on, rather than a second
    // idea of what a clash is.
    const speakerIdsBySession = new Map<string, string[]>();
    for (const row of sessionSpeakerRows) {
      speakerIdsBySession.set(row.sessionId, [
        ...(speakerIdsBySession.get(row.sessionId) ?? []),
        row.userId,
      ]);
    }
    const conflicts = detectConflicts(
      sessions.map((session) => ({
        ...session,
        speakerIds: speakerIdsBySession.get(session.id) ?? [],
      })),
    );

    // "Overdue" is `deriveTaskState`'s answer, the one the roster and the
    // speaker portal already show — not a second due-date comparison here.
    const overdueTasks = buildAssignmentViews(
      taskAssignments,
      new Map(tasks.map((task) => [task.id, task])),
    ).filter((view) => view.state === "overdue").length;

    sessionStats = {
      sessions: sessions.length,
      unscheduled,
      conflicts: conflicts.length,
      speakerCount,
      taskCount: tasks.length,
      overdueTasks,
    };
  }

  /**
   * Where a submission stat card leads: the queue, narrowed to the status the
   * card counted. `view=all` is pinned because these numbers are counted over
   * everything the viewer may read (`loadVisibleSubmissions`), while the queue
   * defaults a reviewer holding assignments to just their own (decisions.md
   * D-066) — without it the card would hand them a shorter list than the
   * number promised.
   */
  function queueHref(status?: string): string {
    const query = new URLSearchParams({ [VIEW_PARAM]: QUEUE_VIEW_ALL });
    if (status) query.set("status", status);
    return `/admin/${eventSlug}/submissions?${query.toString()}`;
  }

  return (
    <div>
      <PageHeader title="Overview" description="Where this event stands right now." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Submissions" value={submissions.length} href={queueHref()} />
        <StatCard
          label="Unreviewed"
          value={unreviewed}
          sublabel="Awaiting a decision"
          href={queueHref("submitted")}
          tone="attention"
          clearLabel="Every submission has a decision"
        />
        <StatCard label="Accepted" value={accepted} href={queueHref("approved")} />
        {sessionStats ? (
          <>
            <StatCard
              label="Sessions"
              value={sessionStats.sessions}
              href={`/admin/${eventSlug}/agenda`}
            />
            <StatCard
              label="Unscheduled sessions"
              value={sessionStats.unscheduled}
              sublabel="Not on the agenda yet"
              href={`/admin/${eventSlug}/agenda`}
              tone="attention"
              clearLabel="Every session has a slot"
            />
            <StatCard
              label="Conflicts"
              value={sessionStats.conflicts}
              sublabel="Clashes on the agenda"
              href={`/admin/${eventSlug}/agenda`}
              tone="attention"
              clearLabel="Nothing clashes"
            />
            <StatCard
              label="Speakers"
              value={sessionStats.speakerCount}
              href={`/admin/${eventSlug}/speakers`}
            />
            <StatCard
              label="Overdue tasks"
              value={sessionStats.overdueTasks}
              sublabel="Past their due date"
              // The roster's own "Overdue" filter, so the list an organizer
              // lands on is exactly the speakers behind this number.
              href={`/admin/${eventSlug}/speakers?status=overdue`}
              tone="attention"
              clearLabel="Nobody is behind"
            />
            <StatCard
              label="Tasks"
              value={sessionStats.taskCount}
              sublabel="Onboarding task types"
              href={`/admin/${eventSlug}/tasks`}
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
              — {user.role === "admin"
                ? "scorecards, historical recommendations, and decisions."
                : "your assigned scorecards and read-only track context."}
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
