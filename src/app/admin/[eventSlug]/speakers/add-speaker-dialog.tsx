"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { addSpeaker } from "./actions";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.email("Enter a valid email address"),
  title: z.string().trim().optional(),
  company: z.string().trim().optional(),
  bio: z.string().trim().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY: FormValues = { name: "", email: "", title: "", company: "", bio: "" };

/**
 * Manual "Add speaker" (spec.md §5, decisions.md D-051) — the way onto the
 * roster for someone who never submitted a proposal, e.g. an invited keynote
 * or a sponsor's presenter.
 */
export function AddSpeakerDialog({ eventSlug }: { eventSlug: string }) {
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });

  async function onSubmit(values: FormValues) {
    const result = await addSpeaker(eventSlug, values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    setOpen(false);
    reset(EMPTY);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Add speaker</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add speaker</DialogTitle>
          <DialogDescription>
            For a speaker who didn&apos;t come through the CFP. If this address already has an
            account, they join this roster instead of getting a second record.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="speaker-name">Name</Label>
            <Input id="speaker-name" placeholder="Ada Lovelace" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="speaker-email">Email</Label>
            <Input
              id="speaker-email"
              type="email"
              placeholder="ada@example.com"
              {...register("email")}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="speaker-title">Title (optional)</Label>
              <Input id="speaker-title" placeholder="Principal Engineer" {...register("title")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="speaker-company">Company (optional)</Label>
              <Input id="speaker-company" placeholder="Analytical Engines" {...register("company")} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="speaker-bio">Bio (optional)</Label>
            <Textarea
              id="speaker-bio"
              rows={4}
              placeholder="They can also write this themselves in the speaker portal."
              {...register("bio")}
            />
          </div>

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add speaker"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
