"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface EventSwitcherOption {
  slug: string;
  name: string;
}

/** Dropdown that jumps between events, preserving the current sub-page
 * (e.g. /admin/a/submissions -> /admin/b/submissions). */
export function EventSwitcher({
  events,
  currentSlug,
}: {
  events: EventSwitcherOption[];
  currentSlug: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(nextSlug: string) {
    if (nextSlug === currentSlug) return;
    // pathname looks like "/admin/{eventSlug}/rest/of/path" — swap segment 2.
    const segments = pathname.split("/");
    segments[2] = nextSlug;
    router.push(segments.join("/"));
  }

  return (
    <Select value={currentSlug} onValueChange={handleChange}>
      <SelectTrigger aria-label="Switch event" size="sm" className="border-none bg-transparent">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {events.map((event) => (
          <SelectItem key={event.slug} value={event.slug}>
            {event.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
