import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import type { SubmissionStatus } from "@/db/entities";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/**
 * One place that maps a submission's status to its label and badge variant.
 *
 * Note the label for `submitted`: in the domain it means "submitted and not
 * yet decided", which organizers read as "unreviewed" (spec.md §4) — so the
 * UI says Unreviewed while the data says submitted.
 */
const STATUS_PRESENTATION: Record<SubmissionStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Unreviewed", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  maybe: { label: "Maybe", variant: "secondary" },
  denied: { label: "Denied", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
};

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const { label, variant } = STATUS_PRESENTATION[status];
  return <Badge variant={variant}>{label}</Badge>;
}
