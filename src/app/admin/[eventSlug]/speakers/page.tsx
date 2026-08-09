import Link from "next/link";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import {
  filterSpeakerRollups,
  TASK_STATE_LABEL,
  type TaskState,
} from "@/domain/onboarding";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AddSpeakerDialog } from "./add-speaker-dialog";
import { ImportSpeakersDialog } from "./import-speakers-dialog";
import { loadSpeakerRoster } from "./roster";
import { SpeakerFilters } from "./speaker-filters";

/** Per-task-state badge styling. `warning` is the shared semantic token for
 * anything due soon (decisions.md D-018) — never a raw amber class. */
const STATE_BADGE_CLASS: Record<TaskState, string> = {
  complete: "border-border text-muted-foreground",
  open: "border-border text-foreground",
  due_soon: "border-warning bg-warning/10 text-warning",
  overdue: "border-destructive bg-destructive/10 text-destructive",
};

/**
 * The profile pieces the program can't be published without (spec.md §6 — a
 * speaker maintains these at /portal/profile, and they feed this roster and
 * the public gallery). Read straight off the speaker's user record, which is
 * the single source of truth for both surfaces.
 */
function missingProfileParts(speaker: { bio: string | null; headshotUrl: string | null }): string[] {
  const missing: string[] = [];
  if (!speaker.bio) missing.push("bio");
  if (!speaker.headshotUrl) missing.push("headshot");
  return missing;
}

/**
 * The event's speaker roster (spec.md §5, §8): who's on the program, and how
 * their onboarding tasks are going — outstanding/overdue counts and a
 * completion percentage, at a glance, in one table. Every row opens that
 * speaker's record (decisions.md D-051).
 *
 * "Confirmed" mirrors the acceptance rule from decisions.md D-017: acceptance
 * auto-creates the session record (even before it's scheduled), so having any
 * session row for this event is what confirmed means. Being *on the roster* is
 * broader — see `rosterSpeakerIds` — because a speaker added by hand or by
 * import has no session yet and still has to be reachable.
 *
 * Admin-only (decisions.md D-047) — the onboarding dashboard isn't part of a
 * reviewer's event workspace.
 */
export default async function SpeakersPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { eventSlug } = await params;
  const { q = "", status = "all" } = await searchParams;
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const { rollups } = await loadSpeakerRoster(repos, event.id);
  const rows = filterSpeakerRollups(rollups, { q, status });

  return (
    <div>
      <PageHeader
        title="Speakers"
        description="Who's on the program, and how their onboarding tasks are going."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ImportSpeakersDialog eventSlug={eventSlug} />
            <AddSpeakerDialog eventSlug={eventSlug} />
          </div>
        }
      />

      {rollups.length === 0 ? (
        <EmptyState
          title="No speakers yet"
          description="Accepting a submission creates the speaker record here — or add one yourself for a speaker who never went through the CFP."
        />
      ) : (
        <>
          <SpeakerFilters q={q} status={status} total={rollups.length} shown={rows.length} />

          {rows.length === 0 ? (
            <EmptyState
              title="Nobody matches those filters"
              description="Try a different search or completion state."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Confirmed</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Completion</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead>Tasks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((rollup) => (
                  <TableRow key={rollup.speaker.id} className="relative">
                    <TableCell>
                      <div className="flex flex-col">
                        {/* Whole-row click target: the name link's overlay
                            pseudo-element stretches across the positioned
                            `TableRow` (same pattern as the submissions list),
                            so a pointer anywhere on the row opens the record
                            while the accessible name and the real `href` stay
                            on the name itself. */}
                        <Link
                          href={`/admin/${eventSlug}/speakers/${rollup.speaker.id}`}
                          className="font-medium text-foreground underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                        >
                          {rollup.speaker.name ?? rollup.speaker.email}
                        </Link>
                        {/* Whatever the speaker last saved on their own profile —
                            the same line the public gallery card prints. */}
                        {rollup.speaker.title || rollup.speaker.company ? (
                          <span className="text-xs text-muted-foreground">
                            {[rollup.speaker.title, rollup.speaker.company].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">{rollup.speaker.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rollup.confirmed ? "default" : "outline"}>
                        {rollup.confirmed ? "Confirmed" : "Not yet"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const missing = missingProfileParts(rollup.speaker);
                        return missing.length === 0 ? (
                          <span className="text-muted-foreground">Complete</span>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-warning bg-warning/10 text-warning"
                            title="The speaker fills this in on their own profile."
                          >
                            No {missing.join(" or ")}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {rollup.totalTasks === 0
                        ? "No tasks"
                        : `${rollup.completedTasks}/${rollup.totalTasks} (${rollup.completionPercent}%)`}
                    </TableCell>
                    <TableCell>
                      {rollup.overdueTasks > 0 ? (
                        <Badge variant="outline" className="border-destructive bg-destructive/10 text-destructive">
                          {rollup.overdueTasks}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {rollup.views.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {rollup.views.map((view) => (
                            <Badge
                              key={view.assignment.id}
                              variant="outline"
                              className={cn(STATE_BADGE_CLASS[view.state])}
                              title={TASK_STATE_LABEL[view.state]}
                            >
                              {view.task.title}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
