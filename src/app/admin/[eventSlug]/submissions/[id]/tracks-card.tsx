"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { Track } from "@/db/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setSubmissionTracks } from "../actions";

/**
 * Admin-only track editor for one submission (product gap: a form with no
 * reserved `tracks` field, or a submitter who picked none, leaves a
 * submission with zero `submission_tracks` rows — and `isRoutedToReviewer`
 * (src/domain/review.ts) means such a talk is unreachable by every reviewer,
 * with no way to fix it short of this). Not rendered for reviewers: routing a
 * talk into (or out of) their own tracks isn't their call.
 *
 * Checkboxes, not a `Select`, for the same reason the rest of the admin e2e
 * surface avoids Radix's dropdown: a submission can carry more than one
 * track, and a plain list of checkable rows survives keyboard, screen reader,
 * and e2e clicks alike without a listbox to click through.
 */
export function TracksCard({
  eventSlug,
  submissionId,
  tracks,
  trackIds,
}: {
  eventSlug: string;
  submissionId: string;
  /** Every track on the event — the checklist's options. */
  tracks: Track[];
  /** This submission's current track ids. */
  trackIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(trackIds));
  const [isPending, startTransition] = useTransition();

  const currentNames = tracks
    .filter((track) => trackIds.includes(track.id))
    .map((track) => track.name);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setSubmissionTracks(eventSlug, submissionId, {
        trackIds: [...selected],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Tracks updated");
      setOpen(false);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracks</CardTitle>
        <CardDescription>
          {currentNames.length === 0
            ? "No track set — this submission can never reach a reviewer's queue."
            : "Which reviewers this submission is routed to."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {currentNames.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">No track</span>
          ) : (
            currentNames.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))
          )}
        </div>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            // Re-seed from the saved value each time the dialog reopens, so a
            // cancelled edit never leaks into the next open.
            if (next) setSelected(new Set(trackIds));
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="self-start">
              Edit tracks
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit tracks</DialogTitle>
              <DialogDescription>
                A reviewer only ever sees submissions in tracks they own — pick at least one to
                put this talk in front of a reviewer.
              </DialogDescription>
            </DialogHeader>

            {tracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This event has no tracks yet — add one in Settings first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {tracks.map((track) => (
                  <div key={track.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`track-${track.id}`}
                      checked={selected.has(track.id)}
                      onCheckedChange={(value) => toggle(track.id, value === true)}
                    />
                    <Label htmlFor={`track-${track.id}`} className="font-normal">
                      {track.name}
                    </Label>
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button onClick={save} disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
