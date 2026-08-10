"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { embedPath, feedUrl } from "@/app/p/[eventSlug]/embed-snippet";

/**
 * Points an admin at the embed/feed surfaces (decisions.md D-040) — until
 * now the generator only ever rendered on the public schedule/speakers
 * pages themselves, so an organizer who never opened those pages had no way
 * to find it. Links out to the public "</> Embed" dialog for the one-line
 * script snippet rather than reproducing it here.
 *
 * Admin-only, same gate as `ProgramPublishCard` (decisions.md D-047).
 */
export function EmbedsCard({ eventSlug, published }: { eventSlug: string; published: boolean }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Embeds & feeds</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          The public schedule and speakers pages can be embedded on another site as a script or
          iframe, or read as a JSON/XML/iCal feed by an app or database.
          {!published && " They resolve once the program is published."}
        </p>
        <div className="flex flex-col gap-2">
          <EmbedLinkRow label="Schedule iframe" path={embedPath(eventSlug, "schedule")} />
          <EmbedLinkRow label="Speakers iframe" path={embedPath(eventSlug, "speakers")} />
          <EmbedLinkRow label="JSON feed" path={feedUrl(eventSlug, "json", "")} />
          <EmbedLinkRow label="XML feed" path={`/p/${eventSlug}/feed.xml`} />
          <EmbedLinkRow label="iCal feed" path={feedUrl(eventSlug, "ics", "")} />
        </div>
        <p className="text-sm text-muted-foreground">
          Need colors, filters, field selection, or another widget type? Open the{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/admin/${eventSlug}/embeds`}>
            embed builder
          </Link>
          . For the one-line defaults, open the{" "}
          <span className="font-mono">{"</> Embed"}</span> dialog on the public{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/p/${eventSlug}/schedule`}>
            schedule
          </Link>{" "}
          or{" "}
          <Link className="text-foreground underline underline-offset-4" href={`/p/${eventSlug}/speakers`}>
            speakers
          </Link>{" "}
          page.
        </p>
      </CardContent>
    </Card>
  );
}

/** One embed/feed URL, shown relative and copied absolute (the origin only
 * exists client-side) — same shape as the public embed dialog's link rows. */
function EmbedLinkRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs font-medium text-foreground">{label}</span>
      <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
        {path}
      </code>
      <Button size="sm" variant="secondary" onClick={() => copyAbsoluteUrl(path)}>
        Copy
      </Button>
    </div>
  );
}

async function copyAbsoluteUrl(path: string): Promise<void> {
  const url = `${window.location.origin}${path}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy — select and copy it manually");
  }
}
