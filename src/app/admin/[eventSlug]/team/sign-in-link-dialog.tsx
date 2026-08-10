"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The visible, selectable URL in this dialog *is* the fallback: the Copy
 * button is a convenience on top of it, not the only way to get the link out,
 * so a denied clipboard (headless and clipboard-denied contexts included)
 * degrades to "select the text" instead of a dead end.
 *
 * Same copy-with-fallback shape as `EmbedLinkRow`
 * (src/app/admin/[eventSlug]/embeds-card.tsx) - reused here rather than
 * reinvented so the two admin surfaces read as one system.
 */
export function SignInLinkDialog({
  url,
  trigger,
}: {
  url: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Sign-in link copied");
    } catch {
      toast.error("Couldn't copy - select and copy it manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign-in link</DialogTitle>
          <DialogDescription>
            The Greenroom sign-in page, with this address filled in. It isn&apos;t a credential by
            itself - it still takes a magic link sent to that address to actually sign in.
          </DialogDescription>
        </DialogHeader>
        <code
          className="block w-full overflow-x-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs text-foreground select-all"
          onClick={(e) => {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(e.currentTarget);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }}
        >
          {url}
        </code>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={copy}>
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
