"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "/admin/crm" },
  { label: "Directory", href: "/admin/directory" },
  { label: "Pipeline", href: "/admin/pipeline" },
] as const;

/** Left nav for the org-level speaker CRM area (spec.md "Org-level speaker
 * CRM", D-077). Mirrors AdminNav's styling so the CRM reads as a sibling of
 * the event workspaces; client-only for active-path styling. Admin-only by
 * construction: the (org) layout guards, so there is no role prop here. */
export function OrgNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
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
