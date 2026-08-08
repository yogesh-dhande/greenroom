"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { Event } from "@/db/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listTimezones } from "@/lib/timezones";
import { RESERVED_EVENT_SLUGS, SLUG_PATTERN } from "@/lib/slug";
import { updateEvent } from "./actions";

const formSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Slug is required")
      .regex(SLUG_PATTERN, "Lowercase letters, numbers, and hyphens only")
      .refine((slug) => !(RESERVED_EVENT_SLUGS as readonly string[]).includes(slug), {
        message: "That slug is reserved — try another",
      }),
    description: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    timezone: z.string().min(1, "Timezone is required"),
    location: z.string(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "End date can't be before the start date",
    path: ["endDate"],
  });
type FormValues = z.infer<typeof formSchema>;

export function EventDetailsForm({ event }: { event: Event }) {
  const router = useRouter();
  // Guarantee the event's current zone shows up even if it isn't in the
  // curated list (e.g. it was set some other way).
  const timezones = listTimezones().includes(event.timezone)
    ? listTimezones()
    : [event.timezone, ...listTimezones()];

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting, isDirty },
    setError,
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: event.name,
      slug: event.slug,
      description: event.description ?? "",
      startDate: event.startDate ?? "",
      endDate: event.endDate ?? "",
      timezone: event.timezone,
      location: event.location ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    const result = await updateEvent(event.id, event.slug, values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success("Event updated");
    reset(values);
    if (result.data.slug !== event.slug) {
      router.push(`/admin/${result.data.slug}/settings`);
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Event name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">URL slug</Label>
        <Input id="slug" {...register("slug")} />
        <p className="text-xs text-muted-foreground">
          Changing this moves the event to a new admin URL.
        </p>
        {errors.slug && <p className="text-sm text-destructive">{errors.slug.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" type="date" {...register("startDate")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" type="date" {...register("endDate")} />
          {errors.endDate && <p className="text-sm text-destructive">{errors.endDate.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Controller
          name="timezone"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue placeholder="Select a timezone" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location">Location</Label>
        <Input id="location" {...register("location")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
