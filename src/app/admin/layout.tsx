import { requireAdminOrReviewer } from "@/lib/session";

/**
 * Auth gate for the whole /admin area (admins + reviewers, spec.md Roles).
 * The visual chrome — top bar, event switcher, left nav — lives one level
 * down in src/app/admin/[eventSlug]/layout.tsx: it's the first layout that
 * actually knows which event is selected (Next.js layouts can't read a
 * child route's dynamic params), so that's where the event-aware top bar
 * has to be built. This layout just enforces the guard and provides the
 * outer flex shell.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminOrReviewer("/admin");
  return <div className="flex min-h-full flex-1 flex-col bg-background">{children}</div>;
}
