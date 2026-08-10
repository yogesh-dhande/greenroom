"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { newEventSchema } from "@/db/entities";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { isReservedEventSlug, SLUG_PATTERN } from "@/lib/slug";

/**
 * Looser than `newEventSchema` on purpose: the form hands over raw string
 * fields (empty string for "not set" rather than null), which this schema
 * accepts and `toNewEvent` below normalizes into the domain shape that
 * `newEventSchema` actually validates.
 */
const createEventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug is required")
    .regex(SLUG_PATTERN, "Lowercase letters, numbers, and hyphens only")
    .refine((slug) => !isReservedEventSlug(slug), {
      message: "That slug is reserved — try another",
    }),
  description: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  timezone: z.string().trim().min(1, "Timezone is required"),
  location: z.string().trim().optional(),
});
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export type CreateEventResult = { ok: true; slug: string } | { ok: false; error: string };

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  await requireAdmin("/admin/new");

  const parsed = createEventInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event details" };
  }
  const v = parsed.data;

  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    return { ok: false, error: "End date can't be before the start date" };
  }

  const repos = await getRepos();
  const existing = await repos.events.getBySlug(v.slug);
  if (existing) {
    return { ok: false, error: "That slug is already in use by another event" };
  }

  const candidate = newEventSchema.safeParse({
    name: v.name,
    slug: v.slug,
    description: v.description || null,
    startDate: v.startDate || null,
    endDate: v.endDate || null,
    timezone: v.timezone,
    location: v.location || null,
    // New events start unpublished (decisions.md D-056) — the organizer
    // publishes from the event overview once the program is ready.
    programPublished: false,
  });
  if (!candidate.success) {
    return { ok: false, error: candidate.error.issues[0]?.message ?? "Invalid event details" };
  }

  try {
    const event = await repos.events.create(candidate.data);
    revalidatePath("/admin");
    return { ok: true, slug: event.slug };
  } catch {
    return { ok: false, error: "Couldn't create the event — try again" };
  }
}
