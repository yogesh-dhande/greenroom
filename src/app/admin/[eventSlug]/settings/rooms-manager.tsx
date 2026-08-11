"use client";

import { useState, useTransition } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Room } from "@/db/entities";
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
import { deleteRoom } from "./actions";
import { RoomFormDialog } from "./room-form-dialog";

export function RoomsManager({ eventSlug, eventId, rooms }: {
  eventSlug: string;
  eventId: string;
  rooms: Room[];
}) {
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    if (!pendingDelete) return;
    const room = pendingDelete;
    startTransition(async () => {
      const result = await deleteRoom(eventSlug, room.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Room deleted");
        setPendingDelete(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Rooms are assigned to sessions when you build the agenda.
        </p>
        <RoomFormDialog
          eventSlug={eventSlug}
          eventId={eventId}
          trigger={
            <Button size="sm" variant="outline">
              <PlusIcon />
              Add room
            </Button>
          }
        />
      </div>

      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" description="Add a room to start scheduling sessions." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.id}>
                <TableCell className="font-medium text-foreground">{room.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {room.capacity ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <RoomFormDialog
                      eventSlug={eventSlug}
                      eventId={eventId}
                      room={room}
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${room.name}`}>
                          <PencilIcon />
                        </Button>
                      }
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${room.name}`}
                      onClick={() => setPendingDelete(room)}
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
        {pendingDelete ? (
          <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{pendingDelete.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone. If this room is used by any sessions, deletion is
              blocked until they&apos;re reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={confirmDelete}>
              {isPending ? "Deleting…" : "Delete room"}
            </AlertDialogAction>
          </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </div>
  );
}
