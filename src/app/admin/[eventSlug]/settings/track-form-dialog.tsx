"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Track } from "@/db/entities";
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
import { createTrack, updateTrack } from "./actions";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0e7490")
    .or(z.literal(""))
    .optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function TrackFormDialog({
  eventSlug,
  eventId,
  track,
  trigger,
}: {
  eventSlug: string;
  eventId: string;
  track?: Track;
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
    defaultValues: { name: track?.name ?? "", color: track?.color ?? "" },
  });

  async function onSubmit(values: FormValues) {
    const result = track
      ? await updateTrack(eventSlug, track.id, values)
      : await createTrack(eventSlug, eventId, values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(track ? "Track updated" : "Track added");
    setOpen(false);
    reset({ name: "", color: "" });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset({ name: track?.name ?? "", color: track?.color ?? "" });
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{track ? "Edit track" : "Add track"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="track-name">Name</Label>
            <Input id="track-name" placeholder="AI Engineering" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="track-color">Color (optional)</Label>
            <Input id="track-color" placeholder="#0e7490" {...register("color")} />
            <p className="text-xs text-muted-foreground">
              Used to color-code this track on the agenda.
            </p>
            {errors.color && <p className="text-sm text-destructive">{errors.color.message}</p>}
          </div>
          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : track ? "Save changes" : "Add track"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
