"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The "Embed" affordance (spec.md "Important / strongly desired": public
 * program embeddable on an external website; questions.md Q6 working
 * assumption: a copy-paste iframe snippet is enough). Renders on the public
 * speaker/schedule pages, next to that page's own chrome-less `/embed`
 * counterpart.
 */
export function EmbedSnippet({ embedPath }: { embedPath: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {"</> Embed"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-medium text-foreground">Embed this page</p>
        <p className="text-xs text-muted-foreground">
          Paste this into any HTML page to show it there, chrome-less.
        </p>
        <EmbedCode embedPath={embedPath} />
      </PopoverContent>
    </Popover>
  );
}

function EmbedCode({ embedPath }: { embedPath: string }) {
  const snippet = iframeSnippet(embedPath);

  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all text-foreground">
        {snippet}
      </pre>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(snippet);
            toast.success("Embed code copied");
          } catch {
            toast.error("Couldn't copy — select and copy the code above");
          }
        }}
      >
        Copy code
      </Button>
    </div>
  );
}

/** The iframe snippet itself — a plain function so it can also be unit-ish
 * verified without rendering (kept trivial on purpose, per questions.md Q6). */
export function iframeSnippet(embedPath: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `<iframe src="${base}${embedPath}" title="Event program" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
}
