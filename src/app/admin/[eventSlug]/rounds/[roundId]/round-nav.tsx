import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Sub-nav across one round's three organizer screens. A server component with
 * an explicit `active` prop rather than a pathname-reading client component —
 * every screen that uses it already knows which one it is.
 */
export function RoundNav({
  eventSlug,
  roundId,
  active,
}: {
  eventSlug: string;
  roundId: string;
  active: "setup" | "assignments" | "results";
}) {
  const base = `/admin/${eventSlug}/rounds/${roundId}`;
  const items = [
    { key: "setup", label: "Setup", href: base },
    { key: "assignments", label: "Assignments", href: `${base}/assignments` },
    { key: "results", label: "Results", href: `${base}/results` },
  ] as const;

  return (
    <nav className="mb-6 flex gap-1 border-b border-border">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            item.key === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
