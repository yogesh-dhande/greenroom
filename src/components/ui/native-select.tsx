"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A plain `<select>` styled to sit alongside shadcn's `Select` trigger
 * (same height/border/radius as its "sm" size) but without Radix: no portal,
 * no focus trap, no listbox to click through. For surfaces that must stay
 * operable by mouse, screen reader, and embed iframe alike — see
 * schedule-view.tsx's facet filters — a native control is the robust choice
 * even though it gives up shadcn's themed dropdown panel.
 */
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative inline-flex w-fit">
      <select
        data-slot="native-select"
        className={cn(
          "h-7 w-full appearance-none rounded-[min(var(--radius-md),10px)] border border-input bg-transparent py-1 pr-7 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { NativeSelect }
