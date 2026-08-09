"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { User } from "@/db/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSpeakerProfile } from "../actions";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  title: z.string().trim().optional(),
  company: z.string().trim().optional(),
  bio: z.string().trim().optional(),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * Organizer-side profile editing (decisions.md D-051): the fields an
 * organizer legitimately fixes on someone else's behalf — a placeholder name,
 * a stale job title, a bio that arrived by email.
 *
 * Headshot and links are absent on purpose: those are the speaker's to set at
 * /portal/profile (spec.md §6), and the roster already flags who's missing one.
 */
export function SpeakerProfileForm({ eventSlug, speaker }: { eventSlug: string; speaker: User }) {
  const defaults: FormValues = {
    name: speaker.name ?? "",
    title: speaker.title ?? "",
    company: speaker.company ?? "",
    bio: speaker.bio ?? "",
  };
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaults });

  async function onSubmit(values: FormValues) {
    const result = await updateSpeakerProfile(eventSlug, { ...values, speakerId: speaker.id });
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    reset(values);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" {...register("name")} />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-title">Title</Label>
          <Input id="profile-title" placeholder="Principal Engineer" {...register("title")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-company">Company</Label>
        <Input id="profile-company" placeholder="Analytical Engines" {...register("company")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-bio">Bio</Label>
        <Textarea id="profile-bio" rows={5} {...register("bio")} />
      </div>

      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save profile"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Shown on the public speaker page and in speaker emails.
        </p>
      </div>
    </form>
  );
}
