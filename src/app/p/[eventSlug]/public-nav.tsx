"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "" },
  { label: "Speakers", href: "/speakers" },
  { label: "Schedule", href: "/schedule" },
] as const;

/** Top nav for the public program (mirrors AdminNav's active-link pattern,
 * but horizontal — this is a public, mobile-first surface). Speakers and
 * Schedule drop out until the program is published (decisions.md D-056)
 * rather than pointing at a coming-soon page. */
export function PublicNav({
  eventSlug,
  programPublished,
}: {
  eventSlug: string;
  programPublished: boolean;
}) {
  const pathname = usePathname();
  const base = `/p/${eventSlug}`;
  const items = programPublished ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.href === "");

  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {items.map((item) => {
        const target = `${base}${item.href}`;
        const isActive = item.href === "" ? pathname === target : pathname.startsWith(target);
        return (
          <Link
            key={item.href}
            href={target}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
