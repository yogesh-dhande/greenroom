"use server";

import { revalidatePath } from "next/cache";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";

export type SetProgramPublishedResult = { ok: true } | { ok: false; error: string };

/**
 * Publishes or unpublishes the event's public program (decisions.md D-056).
 * Admin-only — a reviewer never sees the control and `requireEventAdmin`
 * bounces one who calls the action directly.
 *
 * Reversible on purpose: unpublishing is how an organizer takes a program
 * back off the web after spotting a mistake, so this is the same call with
 * the flag inverted rather than a one-way "go live".
 */
export async function setProgramPublished(
  eventSlug: string,
  published: boolean,
): Promise<SetProgramPublishedResult> {
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  try {
    await repos.events.update(event.id, { programPublished: published });
  } catch {
    return { ok: false, error: "Couldn't update the program — try again" };
  }

  // Every surface the flag gates: the public pages and their feeds, the
  // chrome-less embeds a third-party site iframes, and this overview.
  revalidatePath(`/p/${eventSlug}`, "layout");
  revalidatePath(`/p/${eventSlug}/feed.json`);
  revalidatePath(`/p/${eventSlug}/feed.ics`);
  revalidatePath(`/embed/${eventSlug}`, "layout");
  revalidatePath(`/admin/${eventSlug}`);
  return { ok: true };
}
