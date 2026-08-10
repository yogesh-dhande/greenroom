"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Disclosure trigger for a deliverable's version history and comment thread —
 * a real `<button type="button">` with `aria-expanded`/`aria-controls` wired
 * to the content, so the toggle is exposed to assistive tech and answers a
 * pointer click anywhere on it. Replaces a native `<summary>` that a
 * screen-reader/pointer eval could reach only by tabbing to it.
 */
export function VersionsDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-foreground"
      >
        {label}
      </button>
      {open ? (
        <div id={contentId} className="mt-3 flex flex-col gap-4 rounded-md border border-border p-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
