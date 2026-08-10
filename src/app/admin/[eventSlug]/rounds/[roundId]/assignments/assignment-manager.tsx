"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRingIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { RoundAssignmentStatus, SubmissionStatus } from "@/db/entities";
import { progressByReviewer, progressLabel } from "@/domain/rounds";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CompletionMeter } from "@/components/completion-meter";
import { EmptyState } from "@/components/empty-state";
import {
  GroupChips,
  PickerSearch,
  SelectionSummary,
} from "@/components/people-picker/people-picker";
import { buildGroups, filterByQuery, toggleSelection } from "@/components/people-picker/selection";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { assignSubmissions, assignTrack, unassignSubmission } from "../../actions";
import { remindReviewers } from "./actions";

/**
 * Assigning review work for one round.
 *
 * Pick a reviewer once, then either tick the submissions you want or hand them
 * a whole track in one action — the two things an organizer actually does, in
 * that order. Everything below the picker is a read of the current state, so a
 * mistake is visible and one click from undone.
 */

export interface ReviewerOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SubmissionOption {
  id: string;
  title: string;
  speakers: string[];
  trackIds: string[];
  trackNames: string[];
  status: SubmissionStatus;
  /** Who this one may go to — the track join, decided server-side (D-061). */
  reviewerIds: string[];
}

export interface AssignmentRow {
  id: string;
  submissionId: string;
  reviewerId: string;
  reviewerName: string;
  status: RoundAssignmentStatus;
  recusalReason: string | null;
  scored: boolean;
}

const ALL_TRACKS = "__all__";

export function AssignmentManager({
  eventSlug,
  roundId,
  roundName,
  reviewers,
  tracks,
  submissions,
  assignments,
}: {
  eventSlug: string;
  roundId: string;
  roundName: string;
  reviewers: ReviewerOption[];
  tracks: Array<{ id: string; name: string }>;
  submissions: SubmissionOption[];
  assignments: AssignmentRow[];
}) {
  const router = useRouter();
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [trackId, setTrackId] = useState(ALL_TRACKS);
  const [selected, setSelected] = useState<string[]>([]);
  const [isBusy, startWork] = useTransition();
  const [confirmingRemind, setConfirmingRemind] = useState(false);
  const [isReminding, startRemind] = useTransition();

  const byReviewer = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    for (const row of assignments) {
      map.set(row.reviewerId, [...(map.get(row.reviewerId) ?? []), row]);
    }
    return map;
  }, [assignments]);

  const bySubmission = useMemo(() => {
    const map = new Map<string, AssignmentRow[]>();
    for (const row of assignments) {
      map.set(row.submissionId, [...(map.get(row.submissionId) ?? []), row]);
    }
    return map;
  }, [assignments]);

  const progress = useMemo(() => {
    const scored = new Set(assignments.filter((row) => row.scored).map((row) => row.id));
    return progressByReviewer(assignments, scored);
  }, [assignments]);

  const reviewerById = useMemo(
    () => new Map(reviewers.map((reviewer) => [reviewer.id, reviewer])),
    [reviewers],
  );

  // Same "who still owes work" reading as the Progress column itself — the
  // reminder can never disagree with what's on screen (D-050).
  const pendingCount = useMemo(
    () => progress.filter((row) => row.pending > 0).length,
    [progress],
  );

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startWork(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      setSelected([]);
      router.refresh();
    });
  }

  function sendReminders() {
    startRemind(async () => {
      const result = await remindReviewers(eventSlug, roundId);
      setConfirmingRemind(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.sent === 0) {
        toast.success("Nothing to send", { description: "Every reviewer is already caught up." });
        return;
      }
      toast.success(`Sent ${result.sent} reminder${result.sent === 1 ? "" : "s"}`, {
        description:
          result.failed > 0
            ? `${result.failed} couldn't be delivered — check the communications log.`
            : undefined,
      });
      router.refresh();
    });
  }

  const reviewerName = reviewerById.get(reviewerId)?.name ?? "this reviewer";

  // What the chosen reviewer's tracks actually reach. An assignment outside
  // them would be a queue item leading to a page they can't open (D-060/D-061),
  // so those rows can't be ticked and the server refuses them anyway.
  const assignable = useMemo(
    () => new Set(submissions.filter((s) => s.reviewerIds.includes(reviewerId)).map((s) => s.id)),
    [submissions, reviewerId],
  );

  // Switching reviewer re-decides what was ticked; a selection made for someone
  // else must not survive into an assignment it isn't valid for.
  const selectable = useMemo(
    () => selected.filter((id) => assignable.has(id)),
    [selected, assignable],
  );

  // --- narrowing the pile you're assigning from -----------------------------
  // The same search-plus-groups pattern the recipient pickers use, over
  // submissions instead of people: on a hundred-proposal round, "the ones
  // nobody has yet" and "the ones this reviewer doesn't have" are the two
  // piles an organizer works from, and both are one click.
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () =>
      buildGroups(submissions, [
        {
          id: "unassigned",
          label: "Nobody yet",
          matches: (submission) => (bySubmission.get(submission.id) ?? []).length === 0,
          tone: "warning" as const,
        },
        {
          id: "not-with-reviewer",
          label: `Not with ${reviewerName}`,
          matches: (submission) =>
            !(bySubmission.get(submission.id) ?? []).some((row) => row.reviewerId === reviewerId),
        },
        ...tracks.map((track) => ({
          id: `track:${track.id}`,
          label: track.name,
          matches: (submission: SubmissionOption) => submission.trackIds.includes(track.id),
        })),
      ]),
    [submissions, bySubmission, reviewerId, reviewerName, tracks],
  );

  const shown = useMemo(
    () =>
      filterByQuery(submissions, query, (submission) => [
        submission.title,
        submission.speakers.join(" "),
        submission.trackNames.join(" "),
      ]),
    [submissions, query],
  );

  const selectedTitles = useMemo(
    () => submissions.filter((submission) => selectable.includes(submission.id)).map((s) => s.title),
    [submissions, selectable],
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-reviewer">Reviewer</Label>
            <Select value={reviewerId} onValueChange={setReviewerId}>
              <SelectTrigger id="assign-reviewer" className="w-full">
                <SelectValue placeholder="Choose a reviewer…" />
              </SelectTrigger>
              <SelectContent>
                {reviewers.map((reviewer) => (
                  <SelectItem key={reviewer.id} value={reviewer.id}>
                    {reviewer.name} ({reviewer.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="assign-track">Assign a whole track</Label>
            <div className="flex gap-2">
              <Select value={trackId} onValueChange={setTrackId}>
                <SelectTrigger id="assign-track" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TRACKS}>Every submission</SelectItem>
                  {tracks.map((track) => (
                    <SelectItem key={track.id} value={track.id}>
                      {track.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={isBusy || !reviewerId}
                onClick={() =>
                  run(
                    () =>
                      assignTrack(
                        eventSlug,
                        roundId,
                        reviewerId,
                        trackId === ALL_TRACKS ? "" : trackId,
                      ),
                    `Assigned to ${reviewerName}`,
                  )
                }
              >
                Assign all
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={isBusy || !reviewerId || selectable.length === 0}
            onClick={() =>
              run(
                () => assignSubmissions(eventSlug, roundId, reviewerId, selectable),
                `Assigned to ${reviewerName}`,
              )
            }
          >
            Assign selected to {reviewerName}
          </Button>
          {/* What the button is about to do, in titles, one click from the
              button itself — a mis-ticked row is caught here or not at all. */}
          <SelectionSummary
            names={selectedTitles}
            words={{
              lead: "Assigning",
              singular: "submission",
              plural: "submissions",
              empty: `Nothing ticked yet — of ${assignable.size} ${reviewerName} can review.`,
            }}
          />
        </div>
      </section>

      {submissions.length === 0 ? (
        <EmptyState
          title="No submissions to review yet"
          description="Once proposals arrive through the CFP, assign them to reviewers here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PickerSearch
              value={query}
              onValueChange={setQuery}
              label="Search submissions"
              placeholder="Title, speaker, or track"
              className="w-64"
            />
            <GroupChips
              groups={groups}
              selected={selectable}
              onSelectedChange={(ids) => setSelected(ids.filter((id) => assignable.has(id)))}
              label="Submission groups"
            />
            {query.trim() ? (
              <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
                Showing {shown.length} of {submissions.length}
              </p>
            ) : null}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              variant="inline"
              title="No submission here matches that."
              action={
                <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">&nbsp;</TableHead>
                  <TableHead>Submission</TableHead>
                  <TableHead>Tracks</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((submission) => {
                  const rows = bySubmission.get(submission.id) ?? [];
                  const reachable = assignable.has(submission.id);
                  return (
                    <TableRow key={submission.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={
                            reachable
                              ? `Select ${submission.title}`
                              : `${submission.title} is outside ${reviewerName}'s tracks`
                          }
                          disabled={!reachable}
                          checked={selectable.includes(submission.id)}
                          onCheckedChange={() =>
                            setSelected((current) => toggleSelection(current, submission.id))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-foreground">{submission.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {submission.speakers.length > 0
                            ? submission.speakers.join(", ")
                            : "No speaker on file"}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {submission.trackNames.join(", ") || "—"}
                        {/* Why the row can't be ticked, said out loud — the fix
                            is on Team, not here. */}
                        {reachable ? null : (
                          <p className="text-xs">Outside {reviewerName}&apos;s tracks</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <SubmissionStatusBadge status={submission.status} />
                      </TableCell>
                      <TableCell>
                        {rows.length === 0 ? (
                          <span className="text-sm text-muted-foreground">Nobody yet</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {rows.map((row) => (
                              <span
                                key={row.id}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-foreground"
                              >
                                {row.reviewerName}
                                {row.scored ? (
                                  <Badge variant="secondary">scored</Badge>
                                ) : row.status === "recused" ? (
                                  <Badge variant="outline">recused</Badge>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label={`Unassign ${row.reviewerName} from ${submission.title}`}
                                  className="text-muted-foreground hover:text-foreground"
                                  disabled={isBusy}
                                  onClick={() =>
                                    run(
                                      () => unassignSubmission(eventSlug, roundId, row.id),
                                      "Assignment removed",
                                    )
                                  }
                                >
                                  <XIcon className="size-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-foreground">Reviewers in this round</h2>
            <p className="text-sm text-muted-foreground">
              Only these people can score in this round — each round has its own pool.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pendingCount === 0}
            onClick={() => setConfirmingRemind(true)}
          >
            <BellRingIcon />
            Remind reviewers
          </Button>
        </div>
        <AlertDialog open={confirmingRemind} onOpenChange={(open) => !open && setConfirmingRemind(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remind {pendingCount} reviewer{pendingCount === 1 ? "" : "s"} in {roundName}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Each reviewer with unfiled scorecards gets one email now, with their pending count and a
                link back to their queue. This is a one-time send — nothing gets scheduled.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isReminding}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={isReminding} onClick={sendReminders}>
                {isReminding ? "Sending…" : "Send reminders"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {progress.length === 0 ? (
          <EmptyState
            title="No reviewers in this round yet"
            description="Assign someone a submission above and they'll appear here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reviewer</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Conflicts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progress.map((row) => {
                const recusals = (byReviewer.get(row.reviewerId) ?? []).filter(
                  (assignment) => assignment.status === "recused",
                );
                return (
                  <TableRow key={row.reviewerId} data-testid="reviewer-progress-row">
                    <TableCell className="font-medium text-foreground">
                      {reviewerById.get(row.reviewerId)?.name ?? "Unknown reviewer"}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.assigned}</TableCell>
                    <TableCell>
                      <CompletionMeter
                        done={row.done}
                        total={row.required}
                        label={progressLabel(row)}
                        emptyLabel="Nothing to score"
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {recusals.length === 0
                        ? "—"
                        : recusals
                            .map((assignment) => assignment.recusalReason || "Conflict declared")
                            .join("; ")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
