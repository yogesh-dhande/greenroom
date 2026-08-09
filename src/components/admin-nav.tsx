"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "" },
  { label: "Submissions", href: "/submissions" },
  { label: "Review rounds", href: "/rounds" },
  { label: "Agenda", href: "/agenda" },
  { label: "Speakers", href: "/speakers" },
  { label: "Tasks", href: "/tasks" },
  { label: "Forms", href: "/forms" },
  { label: "Communications", href: "/communications" },
  { label: "Settings", href: "/settings" },
] as const;

/** Left nav for the event-scoped admin area. Client-only so it can read the
 * current path for active-item styling; everything else in the admin shell
 * stays a server component. */
export function AdminNav({ eventSlug }: { eventSlug: string }) {
  const pathname = usePathname();
  const base = `/admin/${eventSlug}`;

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV_ITEMS.map((item) => {
        const target = `${base}${item.href}`;
        const isActive = item.href === "" ? pathname === target : pathname.startsWith(target);
        return (
          <Link
            key={item.href}
            href={target}
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
