"use client";

import { useState, useTransition } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setReviewerTracks } from "./actions";
import type { TeamMemberRow, TrackOption } from "./types";

/**
 * Per-event track assignment for one reviewer — the whole routing engine
 * (spec.md §4): reviewers own tracks, submissions pick tracks, and the
 * intersection is the queue.
 *
 * Selecting nothing is a legitimate choice (a reviewer parked between rounds),
 * so it saves — but the dialog says plainly what the consequence is rather
 * than letting an organizer discover it from a reviewer's confused email.
 */
export function ReviewerTracksDialog({
  eventSlug,
  member,
  tracks,
  trigger,
}: {
  eventSlug: string;
  member: TeamMemberRow;
  tracks: TrackOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(member.trackIds);
  const [isPending, startTransition] = useTransition();

  const label = member.name ?? member.email;

  function toggle(trackId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, trackId] : current.filter((id) => id !== trackId),
    );
  }

  function save() {
    startTransition(async () => {
      const result = await setReviewerTracks(eventSlug, {
        userId: member.id,
        trackIds: selected,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.count === 0
          ? `${label} has no tracks — their review queue will be empty`
          : `${label} reviews ${result.data.count} track${result.data.count === 1 ? "" : "s"}`,
      );
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening should show what's saved, not what was abandoned.
        if (!next) setSelected(member.trackIds);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tracks for {label}</DialogTitle>
          <DialogDescription>
            They&apos;ll see submissions in the tracks you tick here, and nothing else. Tracks on
            other events aren&apos;t affected.
          </DialogDescription>
        </DialogHeader>

        {tracks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This event has no tracks yet — add one in Settings before routing reviewers.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {tracks.map((track) => {
              const id = `track-${member.id}-${track.id}`;
              return (
                <div key={track.id} className="flex items-center gap-2.5">
                  <Checkbox
                    id={id}
                    checked={selected.includes(track.id)}
                    onCheckedChange={(checked) => toggle(track.id, checked === true)}
                  />
                  <Label htmlFor={id} className="font-normal">
                    {track.name}
                  </Label>
                </div>
              );
            })}
            {selected.length === 0 && (
              <p className="inline-flex items-start gap-1.5 text-sm text-muted-foreground">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                With no tracks ticked, {label} will sign in to an empty review queue.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" disabled={isPending || tracks.length === 0} onClick={save}>
            {isPending ? "Saving…" : "Save tracks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
