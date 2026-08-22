"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/db/entities";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "" },
  { label: "Submissions", href: "/submissions" },
  { label: "Review rounds", href: "/rounds" },
  { label: "Agenda", href: "/agenda", adminOnly: true },
  { label: "Speakers", href: "/speakers", adminOnly: true },
  { label: "Tasks", href: "/tasks", adminOnly: true },
  { label: "Files", href: "/files", adminOnly: true },
  { label: "Embeds", href: "/embeds", adminOnly: true },
  { label: "Forms", href: "/forms", adminOnly: true },
  { label: "Communications", href: "/communications", adminOnly: true },
  { label: "Team", href: "/team", adminOnly: true },
  { label: "Settings", href: "/settings", adminOnly: true },
] as const;

/** Left nav for the event-scoped admin area. Client-only so it can read the
 * current path for active-item styling; everything else in the admin shell
 * stays a server component.
 *
 * `role` hides the destinations a reviewer can't open anyway: within an event
 * a reviewer's workspace is exactly Overview, Submissions, and Review rounds
 * (decisions.md D-047) — every other page still guards itself with
 * `requireAdmin`/`requireEventAdmin`, but offering a link that bounces is
 * worse than not offering it. */
export function AdminNav({ eventSlug, role }: { eventSlug: string; role: Role }) {
  const pathname = usePathname();
  const base = `/admin/${eventSlug}`;

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV_ITEMS.filter((item) => !("adminOnly" in item && item.adminOnly) || role === "admin").map((item) => {
        const target = `${base}${item.href}`;
        const isActive = item.href === "" ? pathname === target : pathname.startsWith(target);
        return (
          <Link
            key={item.href}
            href={target}
            // Every one of these links is in the viewport on every admin page,
            // so App Router's default prefetch fires an RSC request for all
            // twelve destinations on every single page view. In the 2026-08-18
            // evaluator run that was roughly 7,400 of 12,886 requests — about
            // 58% of all traffic — each one a real Worker invocation doing real
            // D1 work, to speculate on a sidebar the user clicks at most once.
            // The pages are dynamic and server-rendered; the prefetch buys
            // little and costs a lot at this fan-out.
            prefetch={false}
            className={cn(
              "rounded-md border-l-2 px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "border-primary bg-accent text-accent-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
