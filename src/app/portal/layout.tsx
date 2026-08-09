import Link from "next/link";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";

/** Speaker portal chrome: a simple top bar, no left nav (spec.md §6 — a
 * speaker's whole world is submissions/sessions/tasks/profile, which fit on
 * one page each without a nav rail). The one thing that *does* need a
 * standing link is the profile editor: it's reachable from nowhere else once
 * a speaker leaves the portal home, and spec.md §6 requires it stay reachable
 * from navigation rather than by URL alone. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/portal");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-2">
          <Link
            href="/portal"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            Greenroom
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">Speaker portal</span>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/portal/profile">Your profile</Link>
          </Button>
          <span className="text-xs text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
