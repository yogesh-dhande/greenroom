import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { OrgNav } from "@/components/org-nav";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Org-level speaker CRM chrome (spec.md "Org-level speaker CRM", D-077):
 * sticky top bar and left nav wrapped around /admin/directory, /admin/pipeline
 * and /admin/crm. These pages sit outside any single event, so there is no
 * event switcher; the wordmark links back to the events list.
 *
 * Outer half of the guard: the CRM is admin-only (canAccessOrgCrm — roles are
 * global, D-025), and every child page still re-guards itself.
 */
export default async function OrgCrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin("/admin/directory");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="px-1 text-sm font-semibold tracking-tight text-foreground"
          >
            Greenroom
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="px-1 text-sm font-medium text-foreground">Speaker CRM</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border">
          <div className="px-4 pt-4 pb-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Organization
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">
              Speaker CRM
            </p>
            <p className="text-xs text-muted-foreground">Contacts across every event</p>
          </div>
          <OrgNav />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
