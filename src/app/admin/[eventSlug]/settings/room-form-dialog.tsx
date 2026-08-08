"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Room } from "@/db/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createRoom, updateRoom } from "./actions";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  capacity: z
    .string()
    .trim()
    .regex(/^\d*$/, "Capacity must be a whole number")
    .optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function RoomFormDialog({
  eventSlug,
  eventId,
  room,
  trigger,
}: {
  eventSlug: string;
  eventId: string;
  room?: Room;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: room?.name ?? "", capacity: room?.capacity?.toString() ?? "" },
  });

  async function onSubmit(values: FormValues) {
    const result = room
      ? await updateRoom(eventSlug, room.id, values)
      : await createRoom(eventSlug, eventId, values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(room ? "Room updated" : "Room added");
    setOpen(false);
    reset({ name: "", capacity: "" });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset({ name: room?.name ?? "", capacity: room?.capacity?.toString() ?? "" });
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "Add room"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-name">Name</Label>
            <Input id="room-name" placeholder="Main Stage" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-capacity">Capacity (optional)</Label>
            <Input id="room-capacity" inputMode="numeric" placeholder="120" {...register("capacity")} />
            {errors.capacity && (
              <p className="text-sm text-destructive">{errors.capacity.message}</p>
            )}
          </div>
          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : room ? "Save changes" : "Add room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
