"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SubmissionDecision, SubmissionStatus } from "@/db/entities";
import { SubmissionStatusBadge } from "@/components/submission-status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { decideSubmission } from "../actions";
import { RequestChangesDialog } from "./request-changes-dialog";

/**
 * The binding decision (spec.md section 4), as a bar that rides the bottom of
 * the viewport while the record scrolls underneath it (wave W25).
 *
 * Deciding is the job this page is open for, so the controls are always in
 * reach rather than six hundred pixels down beside the review notes. What the
 * decision *produced* (the session, the tasks, the note that went out) is
 * reference material and stays on the page in DecisionOutcome; the bar carries
 * only the current status and the actions.
 *
 * Admin-only by design — see canRecordDecision in src/domain/review.ts. A
 * reviewer sees the bar read-only: they get to know the outcome of the talk
 * they reviewed, they just don't get to declare it.
 *
 * The options mirror DECISION_OPTIONS in src/domain/review.ts. They are spelled
 * out again here rather than imported because that module reaches the email
 * transport, which has no business in a browser bundle.
 */

interface Option {
  value: SubmissionDecision;
  label: string;
  /** Shown in the confirmation, because these buttons email real people. */
  description: string;
  variant: "default" | "outline" | "destructive";
}

const OPTIONS: Option[] = [
  {
    value: "approved",
    label: "Accept",
    description:
      "This creates the session and the speakers' onboarding tasks, and emails everyone on the talk.",
    variant: "default",
  },
  {
    value: "maybe",
    label: "Waitlist",
    description:
      "This keeps the talk in play without promising a slot. Internal only: speakers keep seeing the proposal as in review.",
    variant: "outline",
  },
  {
    value: "denied",
    label: "Decline",
    description: "This emails the speakers a decline. No session or tasks are created.",
    variant: "destructive",
  },
];

const DECIDED: Partial<Record<SubmissionStatus, string>> = {
  approved: "Accepted",
  maybe: "Waitlisted",
  denied: "Declined",
};

export function DecisionBar({
  eventSlug,
  submissionId,
  status,
  note,
  decidedBy,
  decidedAt,
  canDecide,
  speakerCount,
}: {
  eventSlug: string;
  submissionId: string;
  status: SubmissionStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  canDecide: boolean;
  speakerCount: number;
}) {
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [notify, setNotify] = useState(true);
  const [pending, setPending] = useState<Option | null>(null);
  const [isPending, startTransition] = useTransition();

  const decided = DECIDED[status] ?? null;

  /**
   * Default the notify checkbox to the selected decision (D-028: waitlist
   * defaults off, accept/decline stay on) whenever the admin picks an action —
   * switching to Waitlist unticks it, switching to Accept/Decline re-ticks it.
   * The checkbox is repeated (editable) inside the confirmation dialog, so the
   * admin can still manually override this default before confirming.
   */
  function selectOption(option: Option) {
    setNotify(option.value !== "maybe");
    setPending(option);
  }

  function confirm() {
    if (!pending) return;
    const option = pending;
    startTransition(async () => {
      const result = await decideSubmission(eventSlug, submissionId, {
        decision: option.value,
        note: draftNote,
        notify,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPending(null);
      toast.success(`${DECIDED[result.data.status] ?? "Decision recorded"}`, {
        description: outcomeLine(result.data),
      });
    });
  }

  return (
    <div
      // Sticky rather than fixed, so it belongs to the page's own scroll
      // container (the admin shell's <main>) instead of the window: it spans
      // exactly the content area, and keeps its place in the flow, so nothing
      // is ever stranded underneath it at the foot of the record. The negative
      // inline margin lets the top border and the page background run the full
      // width, so content scrolls under a clean edge.
      className="sticky bottom-0 z-10 -mx-6 mt-6 border-t border-border bg-background px-6 py-3"
      data-testid="decision-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <SubmissionStatusBadge status={status} />
          {decided ? (
            <p className="text-sm text-muted-foreground" data-testid="decision-summary">
              <span className="font-medium text-foreground">{decided}</span>
              {decidedBy ? ` by ${decidedBy}` : ""}
              {decidedAt ? ` on ${decidedAt}` : ""}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="decision-summary">
              No decision recorded yet.
            </p>
          )}
        </div>

        {!canDecide ? (
          <p className="text-sm text-muted-foreground">
            An event admin records the final decision. Your assigned scorecards feed it.
          </p>
        ) : (
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <div className="flex min-w-56 flex-1 items-center gap-2">
              <Label htmlFor="decision-note" className="sr-only">
                Note to the speakers
              </Label>
              {/* One row until it's typed in (field-sizing-content grows it),
                  because a three-row box would cost a third of the bar for a
                  field that is usually left empty. The confirmation dialog
                  repeats it full-size. */}
              <Textarea
                id="decision-note"
                rows={1}
                className="min-h-9 resize-none py-1.5"
                placeholder="Optional note to the speakers, included in the decision email."
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="decision-notify"
                checked={notify}
                onCheckedChange={(value) => setNotify(value === true)}
              />
              <Label htmlFor="decision-notify" className="font-normal whitespace-nowrap">
                Email the speakers
              </Label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={option.variant}
                  disabled={isPending}
                  onClick={() => selectOption(option)}
                >
                  {option.label}
                </Button>
              ))}
              {/* Not a decision: the way to ask for a fix and keep the
                  proposal exactly where it is. */}
              <RequestChangesDialog
                eventSlug={eventSlug}
                submissionId={submissionId}
                hasCoSpeakers={speakerCount > 1}
              />
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.label} this talk?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.description}
              {!notify && " Emails are switched off, so nobody will be told yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* The same draft note as the panel's field, editable here too —
              the natural order is "click Accept, then write the note", and a
              note typed behind an open dialog would otherwise be lost. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="decision-note-confirm">Note to the speakers</Label>
            <Textarea
              id="decision-note-confirm"
              rows={3}
              placeholder="Optional — included in the decision email."
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
            />
          </div>
          {/* The panel's checkbox is behind the overlay once this dialog is
              open, so the default it set (on/off per D-028) is repeated here,
              editable, for a genuine last-second override before Confirm. */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="decision-notify-confirm"
              checked={notify}
              onCheckedChange={(value) => setNotify(value === true)}
            />
            <Label htmlFor="decision-notify-confirm" className="font-normal">
              Email the speakers
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.variant === "destructive" ? "destructive" : "default"}
              disabled={isPending}
              onClick={(event) => {
                // Keep the dialog up while the work runs: accepting writes a
                // session, tasks and emails, and closing early would read as
                // "done" before it is.
                event.preventDefault();
                confirm();
              }}
            >
              {isPending ? "Working…" : `Confirm ${pending?.label.toLowerCase()}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What the decision actually did, for the success toast. */
function outcomeLine(data: {
  sessionCreated: boolean;
  assignmentsCreated: number;
  emailsSent: number;
  emailsFailed: number;
}): string {
  const parts: string[] = [];
  if (data.sessionCreated) parts.push("session created");
  if (data.assignmentsCreated > 0) {
    parts.push(`${data.assignmentsCreated} task${data.assignmentsCreated === 1 ? "" : "s"} assigned`);
  }
  if (data.emailsSent > 0) {
    parts.push(`${data.emailsSent} email${data.emailsSent === 1 ? "" : "s"} sent`);
  }
  if (data.emailsFailed > 0) {
    parts.push(`${data.emailsFailed} email${data.emailsFailed === 1 ? "" : "s"} failed`);
  }
  return parts.length === 0 ? "No further changes." : `${parts.join(", ")}.`;
}
