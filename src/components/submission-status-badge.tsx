import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import type { SubmissionStatus } from "@/db/entities";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/**
 * One place that maps a submission's status to its label and badge variant.
 *
 * Note the label for `submitted`: in the domain it means "submitted and not
 * yet decided", which organizers read as "unreviewed" (spec.md section 4), so
 * the UI says Unreviewed while the data says submitted. It's the row an
 * organizer still owes a decision on, so it carries the shared `warning`
 * tokens (decisions.md D-018) rather than blending in - same treatment as
 * the roster's own due-soon/incomplete badges.
 */
const STATUS_PRESENTATION: Record<
  SubmissionStatus,
  { label: string; variant: BadgeVariant; className?: string }
> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: {
    label: "Unreviewed",
    variant: "outline",
    className: "border-warning bg-warning/10 text-warning",
  },
  approved: { label: "Approved", variant: "default" },
  maybe: { label: "Maybe", variant: "secondary" },
  denied: { label: "Denied", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
};

/** The same wording as the badge, for places that need plain text (CSV). */
export function submissionStatusLabel(status: SubmissionStatus): string {
  return STATUS_PRESENTATION[status].label;
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const { label, variant, className } = STATUS_PRESENTATION[status];
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
