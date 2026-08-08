"use client";

import { useState, useTransition } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Track } from "@/db/entities";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { EmptyState } from "@/components/empty-state";
import { deleteTrack } from "./actions";
import { TrackFormDialog } from "./track-form-dialog";

export function TracksManager({ eventSlug, eventId, tracks }: {
  eventSlug: string;
  eventId: string;
  tracks: Track[];
}) {
  const [pendingDelete, setPendingDelete] = useState<Track | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    if (!pendingDelete) return;
    const track = pendingDelete;
    startTransition(async () => {
      const result = await deleteTrack(eventSlug, track.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Track deleted");
        setPendingDelete(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reviewers are assigned to tracks; submissions are routed to reviewers by track.
        </p>
        <TrackFormDialog
          eventSlug={eventSlug}
          eventId={eventId}
          trigger={
            <Button size="sm" variant="outline">
              <PlusIcon />
              Add track
            </Button>
          }
        />
      </div>

      {tracks.length === 0 ? (
        <EmptyState title="No tracks yet" description="Add a track to start routing submissions." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Color</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tracks.map((track) => (
              <TableRow key={track.id}>
                <TableCell className="font-medium text-foreground">{track.name}</TableCell>
                <TableCell>
                  {track.color ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-3.5 rounded-full ring-1 ring-foreground/10"
                        // Organizer-picked color, not a design token — this is
                        // the one legitimate place for an inline arbitrary
                        // color (D-018 governs the app's own UI, not
                        // user-authored data).
                        style={{ backgroundColor: track.color }}
                      />
                      <span className="text-muted-foreground">{track.color}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <TrackFormDialog
                      eventSlug={eventSlug}
                      eventId={eventId}
                      track={track}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${track.name}`}>
                          <PencilIcon />
                        </Button>
                      }
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${track.name}`}
                      onClick={() => setPendingDelete(track)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{pendingDelete?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone. If this track is used by any submissions or sessions,
              deletion is blocked until they&apos;re reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={confirmDelete}>
              {isPending ? "Deleting…" : "Delete track"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
