/**
 * Team management: who is on an event's staff, and how someone becomes one.
 *
 * Everything here is pure — no repos, no environment, no better-auth — so the
 * three rules that are easy to get subtly wrong (bootstrapping the very first
 * admin, never stranding an instance with zero admins, and deciding whether an
 * invite creates or promotes) can be unit-tested directly.
 *
 * The roles model itself lives in spec.md §1 and decisions.md D-025: roles are
 * a column on `users`, reviewer routing is the `reviewer_tracks` join, and
 * being a speaker at an event is a session/submission link rather than a role.
 */
import type { Role } from "@/db/entities";

// ---------------------------------------------------------------------------
// First-admin bootstrap (decisions.md D-043)
// ---------------------------------------------------------------------------

/**
 * Why an account was (or wasn't) promoted to admin as it signed in.
 *
 * - `admin_emails` — the address is listed in the `ADMIN_EMAILS` env var. This
 *   is the *only* automatic route to admin (D-043): an instance deployed
 *   without `ADMIN_EMAILS` is promoted by hand instead
 *   (docs/deploying.md §7). There is deliberately no "first account to sign in
 *   wins" fallback — on a public deployment that is a race anyone can enter.
 * - `already_admin` / `not_eligible` — no change.
 */
export type AdminBootstrapReason = "admin_emails" | "already_admin" | "not_eligible";

export interface AdminBootstrapDecision {
  promote: boolean;
  reason: AdminBootstrapReason;
}

export interface AdminBootstrapInput {
  /** The signing-in account's address, as stored. Compared case-insensitively. */
  email: string;
  role: Role;
  /** Parsed `ADMIN_EMAILS`; see `parseAdminEmails`. */
  adminEmails: readonly string[];
}

/**
 * Splits the comma-separated `ADMIN_EMAILS` env var into a normalized list.
 *
 * Tolerant on purpose — this value is typed into a deploy console or a
 * `.dev.vars` file by hand, so whitespace, empty slots from a trailing comma,
 * duplicates and mixed case all have to be survivable rather than fatal.
 */
export function parseAdminEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

/**
 * Whether this sign-in should promote the account to admin.
 *
 * One rule, checked on every sign-in rather than only at signup: `ADMIN_EMAILS`
 * is a standing statement of who the operator considers an owner, so it
 * re-promotes an address that was demoted by hand, and it works for an account
 * that already existed as a speaker before the variable was set.
 */
export function decideAdminBootstrap(input: AdminBootstrapInput): AdminBootstrapDecision {
  if (input.role === "admin") return { promote: false, reason: "already_admin" };

  const email = normalizeEmail(input.email);
  if (email && input.adminEmails.includes(email)) {
    return { promote: true, reason: "admin_emails" };
  }
  return { promote: false, reason: "not_eligible" };
}

// ---------------------------------------------------------------------------
// Last-admin guard
// ---------------------------------------------------------------------------

export type RoleChangeCheck =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export interface RoleChangeInput {
  /** Ids of every admin in the instance, including the target if they are one. */
  adminIds: readonly string[];
  targetId: string;
  targetRole: Role;
  nextRole: Role;
  /** Display label for the refusal message — a name, or the email as fallback. */
  targetLabel: string;
}

/**
 * Refuses any change that would leave the instance with no admin — including
 * an admin demoting themselves, which is the easy way to lock everyone out of
 * /admin with no recovery short of a `wrangler d1 execute` one-liner.
 *
 * `changed: false` means the request is a no-op (already that role), which
 * callers should treat as success rather than an error: a select that fires on
 * re-selecting the current value shouldn't produce a red toast.
 */
export function checkRoleChange(input: RoleChangeInput): RoleChangeCheck {
  if (input.targetRole === input.nextRole) return { ok: true, changed: false };
  if (input.targetRole !== "admin") return { ok: true, changed: true };

  const otherAdmins = input.adminIds.filter((id) => id !== input.targetId);
  if (otherAdmins.length === 0) {
    return {
      ok: false,
      error: `${input.targetLabel} is the only admin. Promote someone else to admin first — Greenroom needs at least one.`,
    };
  }
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------------------
// Invite by email
// ---------------------------------------------------------------------------

/**
 * What an "invite this address as <role>" request resolves to once we know
 * whether the address already has an account.
 *
 * There is no separate `invites` table: better-auth's magic-link sign-in looks
 * the address up with `findUserByEmail` and only creates a row when it finds
 * none, so a `users` row written ahead of time is adopted as-is on first
 * sign-in — role and all (see src/lib/auth.ts).
 */
export type InvitePlan =
  | { action: "create"; email: string; role: Role }
  | { action: "change_role"; email: string; role: Role; userId: string; currentRole: Role }
  | { action: "none"; email: string; role: Role; userId: string };

export interface InviteInput {
  email: string;
  role: Role;
  /** The existing account for this address, if there is one. */
  existing: { id: string; role: Role } | null;
}

/** Lowercased + trimmed: addresses are matched case-insensitively everywhere. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function planInvite(input: InviteInput): InvitePlan {
  const email = normalizeEmail(input.email);
  if (!input.existing) return { action: "create", email, role: input.role };
  if (input.existing.role === input.role) {
    return { action: "none", email, role: input.role, userId: input.existing.id };
  }
  return {
    action: "change_role",
    email,
    role: input.role,
    userId: input.existing.id,
    currentRole: input.existing.role,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared by the page and its client islands)
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  reviewer: "Reviewer",
  speaker: "Speaker",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Full access: settings, forms, decisions, and this page.",
  reviewer: "Reads and scores submissions in their assigned tracks.",
  speaker: "Portal only — no access to the admin area.",
};

/** Roles that appear on the team page; speakers are the "remove" target. */
export const TEAM_ROLES: readonly Role[] = ["admin", "reviewer"];
