"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import type { RoundAssignmentStatus, SubmissionStatus } from "@/db/entities";
import { progressByReviewer, progressLabel } from "@/domain/rounds";
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
import { EmptyState } from "@/components/empty-state";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { assignSubmissions, assignTrack, unassignSubmission } from "../../actions";

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
  reviewers,
  tracks,
  submissions,
  assignments,
}: {
  eventSlug: string;
  roundId: string;
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

  const reviewerName = reviewerById.get(reviewerId)?.name ?? "this reviewer";

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
            disabled={isBusy || !reviewerId || selected.length === 0}
            onClick={() =>
              run(
                () => assignSubmissions(eventSlug, roundId, reviewerId, selected),
                `Assigned to ${reviewerName}`,
              )
            }
          >
            Assign selected to {reviewerName}
          </Button>
          <span className="text-sm text-muted-foreground">
            {selected.length} selected of {submissions.length}
          </span>
        </div>
      </section>

      {submissions.length === 0 ? (
        <EmptyState
          title="No submissions to review yet"
          description="Once proposals arrive through the CFP, assign them to reviewers here."
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
            {submissions.map((submission) => {
              const rows = bySubmission.get(submission.id) ?? [];
              return (
                <TableRow key={submission.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${submission.title}`}
                      checked={selected.includes(submission.id)}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, submission.id]
                            : current.filter((id) => id !== submission.id),
                        )
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

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Reviewers in this round</h2>
          <p className="text-sm text-muted-foreground">
            Only these people can score in this round — each round has its own pool.
          </p>
        </div>
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
                    <TableCell className="tabular-nums">{progressLabel(row)}</TableCell>
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
