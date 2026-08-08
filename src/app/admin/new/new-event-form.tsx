"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { RESERVED_EVENT_SLUGS, SLUG_PATTERN, slugify } from "@/lib/slug";
import { createEvent } from "./actions";

// Static list — safe to compute once at module load (see src/lib/timezones.ts).
const TIMEZONES = listTimezones();

const formSchema = z.object({
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
}).refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
  message: "End date can't be before the start date",
  path: ["endDate"],
});
type FormValues = z.infer<typeof formSchema>;

/**
 * The friendly "first event" path (spec.md §1): a single page, plain-English
 * labels, and a slug that writes itself as the organizer types the name.
 */
export function NewEventForm() {
  const router = useRouter();
  const [slugTouched, setSlugTouched] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      slug: "",
      description: "",
      startDate: "",
      endDate: "",
      timezone: "UTC",
      location: "",
    },
  });

  async function onSubmit(values: FormValues) {
    const result = await createEvent(values);
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(`${values.name} is ready`);
    router.push(`/admin/${result.slug}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Event name</Label>
        <Input
          id="name"
          placeholder="AI Engineer Summit 2026"
          {...register("name", {
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              if (!slugTouched) setValue("slug", slugify(e.target.value));
            },
          })}
        />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">URL slug</Label>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">/admin/</span>
          <Input
            id="slug"
            placeholder="ai-engineer-summit-2026"
            {...register("slug", {
              onChange: () => setSlugTouched(true),
            })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Used in the event&apos;s admin and public URLs. Lowercase letters, numbers, and hyphens.
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
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-xs text-muted-foreground">
          All dates and times for this event are shown in this timezone.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="location">Location</Label>
        <Input id="location" placeholder="San Francisco, CA" {...register("location")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="A short description speakers and reviewers will see."
          rows={3}
          {...register("description")}
        />
      </div>

      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create event"}
        </Button>
      </div>
    </form>
  );
}
