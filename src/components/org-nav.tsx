"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Overview", href: "/admin/crm" },
  { label: "Directory", href: "/admin/directory" },
  { label: "Pipeline", href: "/admin/pipeline" },
  { label: "API & MCP", href: "/admin/api" },
] as const;

/** Left nav for organization-wide admin tools. Mirrors AdminNav's styling so
 * these pages read as siblings of the event workspaces; client-only for
 * active-path styling. Admin-only by construction: the (org) layout guards,
 * so there is no role prop here. */
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
