"use server";

import { revalidatePath } from "next/cache";
import { sendRoundReminders } from "@/domain/comms";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/**
 * The "Remind reviewers" action on a round's assignments page (spec.md §6 —
 * review-progress visibility; decisions.md D-050).
 *
 * Colocated here rather than in ../../actions.ts (the shared rounds actions
 * file) to keep this send-mail lane out of the way of the round
 * setup/assignment work other changes there touch. Admin-only, matching
 * every other action in this route tree.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * Emails every reviewer in this round who still has unfiled scorecards —
 * their pending count and a link back to their queue — and logs each send
 * like any other communication. Manual only: there is no scheduled version
 * of this send (D-050).
 */
export async function remindReviewers(eventSlug: string, roundId: string) {
  const viewer = await requireAdmin(`/admin/${eventSlug}/rounds/${roundId}/assignments`);
  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Event not found");

  const round = await repos.reviewRounds.getById(roundId);
  if (!round || round.eventId !== event.id) return fail("That round no longer exists");

  // The acting admin's own identity for {{organizerName}}/{{organizerEmail}}
  // (decisions.md D-053), not the automated-send fallbacks - same pattern as
  // ../../communications/actions.ts's organizerNameFor/organizerEmailFor.
  const comms = await getCommsContext({
    repos,
    organizerName: viewer.name?.trim() || viewer.email,
    organizerEmail: viewer.email,
  });
  let deliveries;
  try {
    deliveries = await sendRoundReminders(comms, { roundId });
  } catch {
    return fail("Couldn't send the reminders — try again");
  }

  const sent = deliveries.filter((delivery) => delivery.status === "sent").length;
  const failed = deliveries.filter((delivery) => delivery.status === "failed").length;

  revalidatePath(`/admin/${eventSlug}/communications`);
  return { ok: true as const, sent, failed };
}
