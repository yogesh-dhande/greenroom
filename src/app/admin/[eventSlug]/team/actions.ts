"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { newUserSchema, roleSchema } from "@/db/entities";
import { sendTeamInvite } from "@/domain/comms";
import { checkRoleChange, normalizeEmail, planInvite, ROLE_LABELS } from "@/domain/team";
import { getAuth } from "@/lib/auth";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import { homePathForRole, requireAdmin } from "@/lib/session";

function fail(error: string) {
  return { ok: false as const, error };
}

/** Every write here is organizer-only — the same guard event settings uses. */
function teamPath(eventSlug: string) {
  return `/admin/${eventSlug}/team`;
}

/** Name if we have one, address otherwise — for messages a human reads. */
function labelFor(person: { name: string | null; email: string }) {
  return person.name?.trim() || person.email;
}

// ---------------------------------------------------------------------------
// Role changes
// ---------------------------------------------------------------------------

const changeRoleInputSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
});
export type ChangeRoleInput = z.infer<typeof changeRoleInputSchema>;

/**
 * Promotes to admin/reviewer or demotes to speaker.
 *
 * The one thing this refuses is a change that would leave the instance with
 * zero admins — including an admin demoting themselves, which would lock the
 * whole team out of /admin with no in-app way back (see `checkRoleChange`).
 */
export async function changeTeamRole(eventSlug: string, input: ChangeRoleInput) {
  await requireAdmin(teamPath(eventSlug));

  const parsed = changeRoleInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid role change");

  const repos = await getRepos();
  const target = await repos.users.getById(parsed.data.userId);
  if (!target) return fail("That account no longer exists");

  const admins = await repos.users.listByRole("admin");
  const check = checkRoleChange({
    adminIds: admins.map((a) => a.id),
    targetId: target.id,
    targetRole: target.role,
    nextRole: parsed.data.role,
    targetLabel: labelFor(target),
  });
  if (!check.ok) return fail(check.error);
  if (!check.changed) {
    return { ok: true as const, data: { message: `${labelFor(target)} is already ${ROLE_LABELS[target.role].toLowerCase()}` } };
  }

  try {
    await repos.users.update(target.id, { role: parsed.data.role });
    // Dropping out of the reviewer role should drop the routing that came
    // with it, or the person keeps showing up as a track's reviewer while
    // having no access to the queue.
    if (target.role === "reviewer" && parsed.data.role !== "reviewer") {
      await repos.tracks.setReviewerTracks(target.id, []);
      // Same for round assignments: a pending one with no filed scorecard is
      // this person's future work, which they no longer have access to do —
      // left behind, it keeps them showing up as an outstanding reviewer in
      // a round's progress and in reminder targeting (D-050). A *filed*
      // scorecard is real work product, not routing, and stays untouched —
      // D-060 reads it back on the submission record regardless of who holds
      // the assignment.
      const assignments = await repos.reviewRounds.listAssignmentsByReviewer(target.id);
      if (assignments.length > 0) {
        const scores = await repos.reviewRounds.listScoresByAssignments(
          assignments.map((a) => a.id),
        );
        const scoredAssignmentIds = new Set(scores.map((score) => score.assignmentId));
        await Promise.all(
          assignments
            .filter((assignment) => !scoredAssignmentIds.has(assignment.id))
            .map((assignment) => repos.reviewRounds.unassign(assignment.id)),
        );
      }
    }
  } catch {
    return fail("Couldn't change that role — try again");
  }

  revalidatePath(teamPath(eventSlug));
  return {
    ok: true as const,
    data: {
      message:
        parsed.data.role === "speaker"
          ? `${labelFor(target)} was removed from the team`
          : `${labelFor(target)} is now ${ROLE_LABELS[parsed.data.role].toLowerCase() === "admin" ? "an admin" : "a reviewer"}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------

const renameTeammateInputSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1, "Enter a name").max(120, "Keep this under 120 characters"),
});
export type RenameTeammateInput = z.infer<typeof renameTeammateInputSchema>;

/**
 * Corrects a teammate's display name — the one profile field an admin can
 * fix on someone else's behalf (everything else on `users` is theirs to set
 * from their own portal profile).
 *
 * Empty is rejected rather than accepted as "clear to null": `src/domain/
 * profile.ts` treats name as the one required field on a person's own
 * profile ("a speaker with no bio is a normal state, an anonymous card on
 * the public gallery is not"), and the rest of the app falls back to email
 * or a placeholder specifically for people who haven't signed in yet to set
 * one — not for someone whose name an admin just wiped by accident.
 */
export async function renameTeammate(eventSlug: string, input: RenameTeammateInput) {
  await requireAdmin(teamPath(eventSlug));

  const parsed = renameTeammateInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid name");

  const repos = await getRepos();
  const target = await repos.users.getById(parsed.data.userId);
  if (!target) return fail("That account no longer exists");

  try {
    await repos.users.update(target.id, { name: parsed.data.name });
  } catch {
    return fail("Couldn't save that name — try again");
  }

  revalidatePath(teamPath(eventSlug));
  return {
    ok: true as const,
    data: { message: `Name updated to ${parsed.data.name}` },
  };
}

// ---------------------------------------------------------------------------
// Reviewer track assignment
// ---------------------------------------------------------------------------

const reviewerTracksInputSchema = z.object({
  userId: z.string().min(1),
  trackIds: z.array(z.string().min(1)),
});
export type ReviewerTracksInput = z.infer<typeof reviewerTracksInputSchema>;

/**
 * Replaces a reviewer's tracks *for this event only* — `reviewer_tracks` is
 * not event-scoped, so a blanket replace would quietly unassign them from
 * every other event on the instance.
 *
 * An empty selection is allowed on purpose (a reviewer parked between rounds
 * is a real state); the UI says out loud that their queue will be empty.
 */
export async function setReviewerTracks(eventSlug: string, input: ReviewerTracksInput) {
  await requireAdmin(teamPath(eventSlug));

  const parsed = reviewerTracksInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid track selection");

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Event not found");

  const target = await repos.users.getById(parsed.data.userId);
  if (!target) return fail("That account no longer exists");
  if (target.role !== "reviewer") return fail("Only reviewers can be assigned tracks");

  try {
    await repos.tracks.setReviewerTracksForEvent(target.id, event.id, parsed.data.trackIds);
  } catch {
    return fail("Couldn't save those tracks — try again");
  }

  revalidatePath(teamPath(eventSlug));
  return {
    ok: true as const,
    data: { count: parsed.data.trackIds.length },
  };
}

// ---------------------------------------------------------------------------
// Invite by email
// ---------------------------------------------------------------------------

const inviteInputSchema = z.object({
  email: z.email("Enter a valid email address"),
  role: z.enum(["admin", "reviewer"]),
  // Optional: written onto the pre-created user row so reviewer pools and
  // rosters show a human name before first sign-in (D-044(3), D-062). Empty
  // string (an untouched input) is treated the same as omitted.
  name: z
    .string()
    .trim()
    .max(120, "Keep this under 120 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;

/**
 * Adds someone to the team by address.
 *
 * If the address already has an account it's simply given the role; if it
 * doesn't, we write the `users` row now, with the role already set. That row
 * is not a placeholder better-auth has to reconcile later: its magic-link
 * verify handler looks the address up with `findUserByEmail` and only calls
 * `createUser` when it finds nothing, so a pre-created row is adopted as-is on
 * first sign-in (it flips `emailVerified` and never touches `role`). That's
 * why there is no `invites` table and no migration for this wave.
 *
 * An invitation email goes out through the same sender and communications
 * log as every other send (D-062) — the address doesn't have to be handed
 * the sign-in URL by hand anymore. A failed send never fails the invite
 * itself: the team-membership write already succeeded, and `deliver` has
 * already logged the failure for the organizer to see in the comms log.
 */
export async function inviteTeammate(eventSlug: string, input: InviteInput) {
  const viewer = await requireAdmin(teamPath(eventSlug));

  const parsed = inviteInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid invite");

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) return fail("Event not found");

  const email = normalizeEmail(parsed.data.email);
  const existing = await repos.users.getByEmail(email);
  const plan = planInvite({
    email,
    role: parsed.data.role,
    existing: existing ? { id: existing.id, role: existing.role } : null,
  });

  if (plan.action === "none" && existing) {
    return fail(`${labelFor(existing)} is already ${ROLE_LABELS[plan.role].toLowerCase() === "admin" ? "an admin" : "a reviewer"}`);
  }

  /**
   * Sends the invite email and reports whether it actually went out.
   *
   * The membership write already succeeded by the time this runs, and a
   * mail-side failure (a bad transport config, a bounced address) must not
   * undo it or read back as an error the admin has to retry — but silently
   * swallowing the result told the admin "invited" when nobody was emailed,
   * with no way to tell short of the recipient never showing up. The caller
   * folds this into an honest message instead.
   */
  async function invite(userId: string): Promise<{ delivered: boolean; error: string | null }> {
    const comms = await getCommsContext({ repos, organizerName: labelFor(viewer) });
    try {
      const delivery = await sendTeamInvite(comms, {
        userId,
        email,
        roleLabel: ROLE_LABELS[plan.role],
        eventName: event!.name,
        inviterName: labelFor(viewer),
      });
      if (delivery.status === "failed") {
        console.warn(`Couldn't send team invite to ${email}:`, delivery.error);
      }
      return {
        delivered: delivery.status === "sent",
        error: delivery.status === "failed" ? (delivery.error ?? "Delivery failed") : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Couldn't send team invite to ${email}:`, error);
      return { delivered: false, error: message };
    }
  }

  if (plan.action === "change_role" && existing) {
    const admins = await repos.users.listByRole("admin");
    const check = checkRoleChange({
      adminIds: admins.map((a) => a.id),
      targetId: existing.id,
      targetRole: existing.role,
      nextRole: plan.role,
      targetLabel: labelFor(existing),
    });
    if (!check.ok) return fail(check.error);

    try {
      await repos.users.update(existing.id, { role: plan.role });
    } catch {
      return fail("Couldn't update that account — try again");
    }
    const delivery = await invite(existing.id);
    revalidatePath(teamPath(eventSlug));
    const roleLabel = plan.role === "admin" ? "an admin" : "a reviewer";
    return {
      ok: true as const,
      data: {
        created: false,
        email,
        message: delivery.delivered
          ? `${labelFor(existing)} already had an account — they're now ${roleLabel}`
          : `${labelFor(existing)} already had an account and is now ${roleLabel}, but the invite email failed to send${delivery.error ? ` (${delivery.error})` : ""}. Share the sign-in page yourself, or try "Send sign-in link" from the roster below.`,
        // An existing account keeps its own profile name - a name typed into
        // this form for someone who already has an account is never written
        // (eval finding: it used to vanish with no indication it was
        // dropped).
        nameIgnored: Boolean(parsed.data.name),
        // The role change/account creation above already succeeded even when
        // this is true — see `invite`'s doc comment for why a failed send
        // doesn't roll it back.
        emailFailed: !delivery.delivered,
      },
    };
  }

  // No account yet: write the row the magic link will land on.
  const candidate = newUserSchema.safeParse({
    email,
    // Left unverified: the first magic link they click is what proves the
    // address, exactly as it would for a brand-new signup.
    emailVerified: false,
    name: parsed.data.name ?? null,
    role: plan.role,
    title: null,
    company: null,
    bio: null,
    headshotUrl: null,
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
  });
  if (!candidate.success) return fail("Enter a valid email address");

  let created;
  try {
    created = await repos.users.create(candidate.data);
  } catch {
    return fail("Couldn't add that person — try again");
  }
  const delivery = await invite(created.id);

  revalidatePath(teamPath(eventSlug));
  const roleLabel = plan.role === "admin" ? "an admin" : "a reviewer";
  return {
    ok: true as const,
    data: {
      created: true,
      email,
      message: delivery.delivered
        ? `${email} can now sign in as ${roleLabel}`
        : `${email} was added as ${roleLabel}, but the invite email failed to send${delivery.error ? ` (${delivery.error})` : ""}. Share the sign-in page yourself, or try "Send sign-in link" from the roster below.`,
      nameIgnored: false,
      emailFailed: !delivery.delivered,
    },
  };
}

// ---------------------------------------------------------------------------
// Send sign-in link
// ---------------------------------------------------------------------------

const sendSignInLinkInputSchema = z.object({
  userId: z.string().min(1),
});
export type SendSignInLinkInput = z.infer<typeof sendSignInLinkInputSchema>;

/**
 * Emails a teammate a real, one-click magic sign-in link on demand, through
 * the same server API `src/app/login` drives via `authClient.signIn.magicLink`
 * (`auth.api.signInMagicLink`) - a genuine token-bearing sign-in URL, not just
 * a pointer at /login. It goes out through `magicLink.sendMagicLink` in
 * src/lib/auth.ts, which is wired to the email_log-writing sender, so every
 * send lands in the communications log exactly like a team invite does.
 *
 * Admin-only (`requireAdmin`, same guard as every other write on this page).
 * Re-sending is safe and expected - "they say it never arrived" is the usual
 * reason to press this - each send is an independent token.
 */
export async function sendTeamSignInLink(eventSlug: string, input: SendSignInLinkInput) {
  await requireAdmin(teamPath(eventSlug));

  const parsed = sendSignInLinkInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid teammate");

  const repos = await getRepos();
  const target = await repos.users.getById(parsed.data.userId);
  if (!target) return fail("That account no longer exists");
  if (target.role !== "admin" && target.role !== "reviewer") {
    return fail("Only admins and reviewers sign in through the admin area");
  }

  try {
    const auth = await getAuth();
    await auth.api.signInMagicLink({
      body: { email: target.email, callbackURL: homePathForRole(target.role) },
      headers: await headers(),
    });
  } catch (error) {
    console.warn(`Couldn't send sign-in link to ${target.email}:`, error);
    return fail("Couldn't send the sign-in link - try again");
  }

  return {
    ok: true as const,
    data: { message: `Sign-in link emailed to ${labelFor(target)}` },
  };
}
