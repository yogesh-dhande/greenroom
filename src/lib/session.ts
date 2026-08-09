import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { roleSchema, type Event, type Role } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { accessibleEvents, canAccessEvent } from "@/domain/team";
import { getAuth } from "@/lib/auth";
import { getRepos } from "@/lib/db";

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

/** A viewer admitted to an event, with the event record the guard loaded. */
export interface EventAccess {
  user: SessionUser;
  event: Event;
}

/**
 * Guard for one event's admin area (decisions.md D-045): admins reach every
 * event, a reviewer only the events where they hold at least one track.
 * A reviewer who reaches for anything else is sent back to /admin, which shows
 * them the events they do have.
 *
 * The event-scoped layout applies this so no child page can be reached
 * unguarded, and each page applies it again for itself — the layout is
 * defense in depth, not a page's authorization.
 */
export async function requireEventAccess(
  eventSlug: string,
  next?: string,
): Promise<EventAccess> {
  const user = await requireAdminOrReviewer(next ?? `/admin/${eventSlug}`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  const eventIds = await reviewerEventIds(repos, user);
  if (!canAccessEvent(user.role, event.id, eventIds)) redirect("/admin");
  return { user, event };
}

/**
 * Guard for an event's admin-only pages (decisions.md D-047): Agenda,
 * Speakers, Tasks, Forms, Communications, Team, and Settings. `requireAdmin`
 * handles the role check and redirect; this adds the event lookup those
 * pages need, the same shape `requireEventAccess` returns.
 *
 * A reviewer who reaches for one of these is bounced to /admin like any
 * other `requireAdmin` call — the event-scoped layout already let them into
 * the event via `requireEventAccess`, but that only grants the three pages
 * D-047 names as reviewer-visible, not this one.
 */
export async function requireEventAdmin(eventSlug: string, next?: string): Promise<EventAccess> {
  const user = await requireAdmin(next ?? `/admin/${eventSlug}`);

  const repos = await getRepos();
  const event = await repos.events.getBySlug(eventSlug);
  if (!event) notFound();

  return { user, event };
}

/** Every event this viewer may open — the switcher and the /admin index. */
export async function listAccessibleEvents(user: SessionUser): Promise<Event[]> {
  const repos = await getRepos();
  const [events, eventIds] = await Promise.all([
    repos.events.listAll(),
    reviewerEventIds(repos, user),
  ]);
  return accessibleEvents(user.role, events, eventIds);
}

/**
 * The events a reviewer holds tracks on. Empty for everyone else: admins are
 * admitted by role, and no list would admit a speaker.
 */
async function reviewerEventIds(repos: Repos, user: SessionUser): Promise<string[]> {
  if (user.role !== "reviewer") return [];
  const tracks = await repos.tracks.listByReviewer(user.id);
  return [...new Set(tracks.map((track) => track.eventId))];
}

/** Where a user belongs immediately after signing in. */
export function homePathForRole(role: Role): string {
  return role === "speaker" ? "/portal" : "/admin";
}
