import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { roleSchema, type Role } from "@/db/entities";
import { getAuth } from "@/lib/auth";

/**
 * The signed-in person, as server components and route handlers see them.
 * Deliberately smaller than the full `User` entity: guards only ever need
 * identity + role, and this keeps auth concerns out of the domain types.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

/** Roles allowed into /admin (spec.md: reviewers see only their tracks). */
const ADMIN_AREA_ROLES: Role[] = ["admin", "reviewer"];

/** Returns the signed-in user, or null when there is no valid session. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const user = session.user as { id: string; email: string; name?: string | null; role?: unknown };
  // better-auth types `role` as a loose additional field; narrow it here so
  // nothing downstream has to trust an unvalidated string.
  const role = roleSchema.safeParse(user.role);
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: role.success ? role.data : "speaker",
  };
}

/** Signed-in or bounced to /login (with a `next` hint for post-login return). */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/**
 * Guard for the /admin area: admins and reviewers only. A signed-in speaker
 * who wanders in is sent to their own portal rather than the login page —
 * re-authenticating wouldn't help them.
 */
export async function requireAdminOrReviewer(next?: string): Promise<SessionUser> {
  const user = await requireUser(next);
  if (!ADMIN_AREA_ROLES.includes(user.role)) redirect("/portal");
  return user;
}

/** Guard for admin-only actions (event settings, form publishing, decisions). */
export async function requireAdmin(next?: string): Promise<SessionUser> {
  const user = await requireUser(next);
  if (user.role !== "admin") redirect("/admin");
  return user;
}

/** Where a user belongs immediately after signing in. */
export function homePathForRole(role: Role): string {
  return role === "speaker" ? "/portal" : "/admin";
}
