import Link from "next/link";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import {
  filterSpeakerRollups,
  findDuplicateNameSpeakerIds,
  otherSpeakersWithSameName,
  TASK_STATE_LABEL,
  type AssignmentView,
  type SpeakerRollup,
} from "@/domain/onboarding";
import { formatDueDate } from "@/lib/event-time";
import { CompletionMeter } from "@/components/completion-meter";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { TaskStateStrip } from "@/components/task-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { AddSpeakerDialog } from "./add-speaker-dialog";
import { ImportSpeakersDialog } from "./import-speakers-dialog";
import { loadSpeakerRoster } from "./roster";
import { SpeakerFilters } from "./speaker-filters";

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
 * "Upload your headshot — Overdue (due Aug 8, 2026)": a square's tooltip and
 * accessible name in one line, so an admin doesn't have to open the speaker
 * record to read what a colored square means. Due dates render in the event's
 * own zone (decisions.md D-055) — never the viewer's.
 */
function taskSquareTitle(view: AssignmentView, timeZone: string): string {
  const due = view.task.dueAt ? `due ${formatDueDate(view.task.dueAt, timeZone)}` : "no due date";
  return `${view.task.title} — ${TASK_STATE_LABEL[view.state]} (${due})`;
}

/**
 * The earliest due date among a speaker's still-outstanding tasks — what the
 * Overdue column's tooltip surfaces. The column itself only has room for a
 * count; this is the per-task due date backing it (fix 3 of D-055's cleanup).
 */
function earliestOutstandingDue(views: AssignmentView[], timeZone: string): string | null {
  const dueDates = views
    .filter((view) => view.state !== "complete" && view.task.dueAt)
    .map((view) => view.task.dueAt as Date)
    .sort((a, b) => a.getTime() - b.getTime());
  return dueDates.length > 0 ? formatDueDate(dueDates[0], timeZone) : null;
}

/** "Another roster entry is also named Priya Raman (priya@a.com,
 * priya@b.com)" — names the collision and who else it's with, so the badge
 * is meaningful without opening either record (decisions.md D-059). */
function duplicateNameTitle(rollup: SpeakerRollup, rollups: SpeakerRollup[]): string {
  const name = rollup.speaker.name?.trim() ?? "";
  const otherEmails = otherSpeakersWithSameName(rollups, rollup.speaker.id).map((s) => s.email);
  return `Another roster entry is also named ${name} (${otherEmails.join(", ")})`;
}

/**
 * The event's speaker roster (spec.md §5, §8): who's on the program, and how
 * their onboarding tasks are going — outstanding/overdue counts and a
 * completion percentage, at a glance, in one table. Every row opens that
 * speaker's record (decisions.md D-051).
 *
 * "Confirmed" is the organizer's stored status when they've set one on the
 * speaker's record, and otherwise the acceptance rule from decisions.md
 * D-017: acceptance auto-creates the session record (even before it's
 * scheduled), so having any session row for this event is what confirmed
 * means by default (decisions.md D-068 — the column, the filter and the
 * record page all read the same resolved value). Being *on the roster* is
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
  searchParams: Promise<{ q?: string; status?: string; confirmation?: string }>;
}) {
  const { eventSlug } = await params;
  const { q = "", status = "all", confirmation = "all" } = await searchParams;
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const { rollups } = await loadSpeakerRoster(repos, event.id);
  const rows = filterSpeakerRollups(rollups, { q, status, confirmation });
  // Checked against the whole roster, not just the filtered rows, so a
  // collision doesn't disappear just because a search/status filter hides
  // the other name (decisions.md D-059).
  const duplicateIds = findDuplicateNameSpeakerIds(rollups);

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
          <SpeakerFilters
            q={q}
            status={status}
            confirmation={confirmation}
            total={rollups.length}
            shown={rows.length}
          />

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
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/${eventSlug}/speakers/${rollup.speaker.id}`}
                            className="font-medium text-foreground underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                          >
                            {rollup.speaker.name ?? rollup.speaker.email}
                          </Link>
                          {duplicateIds.has(rollup.speaker.id) ? (
                            <Badge
                              variant="outline"
                              className="border-warning bg-warning/10 text-warning"
                              title={duplicateNameTitle(rollup, rollups)}
                            >
                              Possible duplicate
                            </Badge>
                          ) : null}
                        </div>
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
                      <Badge
                        variant={rollup.confirmed ? "default" : "outline"}
                        title={
                          rollup.confirmationStatus
                            ? "Set by an organizer on the speaker's record"
                            : "Automatic — follows their sessions"
                        }
                      >
                        {rollup.confirmed
                          ? "Confirmed"
                          : rollup.confirmationStatus === "declined"
                            ? "Declined"
                            : "Not yet"}
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
                    <TableCell>
                      <CompletionMeter
                        done={rollup.completedTasks}
                        total={rollup.totalTasks}
                        emptyLabel="No tasks"
                      />
                    </TableCell>
                    <TableCell>
                      {rollup.overdueTasks > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-destructive bg-destructive/10 text-destructive"
                          title={
                            // Surface the earliest thing they owe, not just the
                            // count — the earliest outstanding due date, in the
                            // event's own zone (decisions.md D-055).
                            (() => {
                              const earliest = earliestOutstandingDue(rollup.views, event.timezone);
                              return earliest
                                ? `Earliest due ${earliest}`
                                : `${rollup.overdueTasks} overdue task${rollup.overdueTasks === 1 ? "" : "s"}`;
                            })()
                          }
                        >
                          {rollup.overdueTasks}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Squares rather than title pills: the titles are
                          repeated on every row of the table, and spelling
                          them out wrapped each row to two or three lines.
                          The title survives as the square's tooltip — which
                          is why the strip is lifted above the name link's
                          whole-row overlay, unlike the rest of the row: the
                          tooltip is now the only way to read a task's title
                          from here, so the overlay must not swallow the
                          hover. */}
                      <TaskStateStrip
                        className="relative z-10"
                        items={rollup.views.map((view) => ({
                          key: view.assignment.id,
                          state: view.state,
                          title: taskSquareTitle(view, event.timezone),
                        }))}
                      />
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
