"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type EmbedView = "schedule" | "speakers";

/**
 * The "Embed" affordance (spec.md "embeddable on an external website";
 * decisions.md D-040: the public program's embed surface matches
 * Sessionboard's mechanism set rather than "iframe snippet only"). Offers,
 * in the order Sessionboard's own help center documents them: the one-line
 * JS embed as the headline option, the plain iframe snippet for sites that
 * forbid third-party scripts, then the JSON and iCal feeds for consumers
 * that aren't a web page at all. Renders on the public speaker/schedule
 * pages, next to that page's own chrome-less `/embed` counterpart.
 */
export function EmbedSnippet({ eventSlug, view }: { eventSlug: string; view: EmbedView }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {"</> Embed"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="text-sm font-medium text-foreground">Embed this page</p>
        <p className="text-xs text-muted-foreground">
          Pick whichever fits the site you&apos;re pasting into.
        </p>
        <div className="mt-3 flex flex-col gap-4">
          <EmbedCodeOption
            label="One-line script"
            hint="Auto-sizing iframe — the easiest option for most sites."
            snippet={scriptSnippet(eventSlug, view)}
          />
          <EmbedCodeOption
            label="Iframe"
            hint="Plain HTML, for sites that don't allow third-party scripts."
            snippet={iframeSnippet(embedPath(eventSlug, view))}
          />
          <EmbedLinkOption
            label="JSON feed"
            hint="Sessions and speakers, for an app or database."
            url={feedUrl(eventSlug, "json")}
          />
          <EmbedLinkOption
            label="iCal feed"
            hint="Subscribe to the schedule from any calendar app."
            url={feedUrl(eventSlug, "ics")}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

async function copyToClipboard(value: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select and copy it manually");
  }
}

function EmbedCodeOption({
  label,
  hint,
  snippet,
}: {
  label: string;
  hint: string;
  snippet: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all text-foreground">
        {snippet}
      </pre>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => copyToClipboard(snippet, `${label} code`)}
      >
        Copy code
      </Button>
    </div>
  );
}

function EmbedLinkOption({ label, hint, url }: { label: string; hint: string; url: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-foreground hover:underline"
        >
          {url}
        </a>
        <Button size="sm" variant="secondary" onClick={() => copyToClipboard(url, `${label} link`)}>
          Copy
        </Button>
      </div>
    </div>
  );
}

/** Where the origin comes from when no override is given (tests pass one
 * explicitly; the browser has `window.location`). */
function resolveOrigin(origin?: string): string {
  return origin ?? (typeof window !== "undefined" ? window.location.origin : "");
}

/** Path of the chrome-less embed page for one event/view — shared by the
 * iframe snippet here and by the `/embed/<event>/<view>` route it points at. */
export function embedPath(eventSlug: string, view: EmbedView): string {
  return `/embed/${eventSlug}/${view}`;
}

/** The one-line script embed (decisions.md D-040's headline option) as a
 * user would paste it — a plain function so it's verifiable without
 * rendering, same as `iframeSnippet` below (questions.md Q6). */
export function scriptSnippet(eventSlug: string, view: EmbedView, origin?: string): string {
  const base = resolveOrigin(origin);
  return `<script src="${base}/embed.js" data-event="${eventSlug}" data-view="${view}" async></script>`;
}

/** The iframe snippet itself — a plain function so it can also be unit-ish
 * verified without rendering (kept trivial on purpose, per questions.md Q6). */
export function iframeSnippet(embedPath: string, origin?: string): string {
  const base = resolveOrigin(origin);
  return `<iframe src="${base}${embedPath}" title="Event program" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
}

/** Absolute URL of the public JSON/iCal feed for one event. */
export function feedUrl(eventSlug: string, kind: "json" | "ics", origin?: string): string {
  const base = resolveOrigin(origin);
  return `${base}/p/${eventSlug}/feed.${kind}`;
}
