"use server";

import { revalidatePath } from "next/cache";
import { planProgramPublish, type ProgramPublishPlan } from "@/domain/program";
import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";

export type SetProgramPublishedResult =
  | { ok: true; plan: ProgramPublishPlan }
  | { ok: false; error: string };

export type GetProgramPublishPlanResult =
  | { ok: true; plan: ProgramPublishPlan }
  | { ok: false; error: string };

/**
 * What publishing right now would make public versus hold back (the fix for
 * the silent-drop bug: publish used to report success while quietly omitting
 * sessions whose content wasn't signed off, D-072). Read-only — used both to
 * preview the effect before the confirm dialog's action fires, and to keep
 * showing the held-back set on the card after publishing.
 */
export async function getProgramPublishPlan(
  eventSlug: string,
): Promise<GetProgramPublishPlanResult> {
  const { event } = await requireEventAdmin(eventSlug);
  const repos = await getRepos();
  const sessions = await repos.sessions.listByEvent(event.id);
  return { ok: true, plan: planProgramPublish(sessions) };
}

/**
 * Publishes or unpublishes the event's public program (decisions.md D-056).
 * Admin-only — a reviewer never sees the control and `requireEventAdmin`
 * bounces one who calls the action directly.
 *
 * Reversible on purpose: unpublishing is how an organizer takes a program
 * back off the web after spotting a mistake, so this is the same call with
 * the flag inverted rather than a one-way "go live".
 *
 * Returns the publish plan alongside `ok` so the card can report exactly
 * what went live and what was held back, without a second round trip.
 */
export async function setProgramPublished(
  eventSlug: string,
  published: boolean,
): Promise<SetProgramPublishedResult> {
  const { event } = await requireEventAdmin(eventSlug);

  const repos = await getRepos();
  const sessions = await repos.sessions.listByEvent(event.id);
  const plan = planProgramPublish(sessions);

  try {
    await repos.events.update(event.id, { programPublished: published });
  } catch {
    return { ok: false, error: "Couldn't update the program — try again" };
  }

  // Every surface the flag gates: the public pages and their feeds, the
  // chrome-less embeds a third-party site iframes, and this overview.
  revalidatePath(`/p/${eventSlug}`, "layout");
  revalidatePath(`/p/${eventSlug}/feed.json`);
  revalidatePath(`/p/${eventSlug}/feed.xml`);
  revalidatePath(`/p/${eventSlug}/feed.ics`);
  revalidatePath(`/embed/${eventSlug}`, "layout");
  revalidatePath(`/admin/${eventSlug}`);
  return { ok: true, plan };
}
