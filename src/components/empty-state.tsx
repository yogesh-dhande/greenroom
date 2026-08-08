import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.ComponentProps<"div"> {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Quiet placeholder for a page/section with no data yet.
 *
 * App-level composite rather than a shadcn registry component (shadcn has no
 * empty-state primitive), so it lives outside src/components/ui — that
 * directory stays exactly what `shadcn add` generated, and re-running the CLI
 * can never clobber our own components. Colors come from the semantic token
 * set only.
 */
export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border border-dashed border-border p-8",
        className,
      )}
      {...props}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
