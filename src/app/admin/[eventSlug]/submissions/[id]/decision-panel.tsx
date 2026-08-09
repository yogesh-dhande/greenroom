"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SubmissionDecision, SubmissionStatus } from "@/db/entities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * The binding decision (spec.md §4) and everything it sets off (spec.md §5).
 *
 * Admin-only by design — see canRecordDecision in src/domain/review.ts. A
 * reviewer sees this panel read-only: they get to know the outcome of the talk
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

export function DecisionPanel({
  eventSlug,
  submissionId,
  status,
  note,
  decidedBy,
  decidedAt,
  canDecide,
  session,
  taskCount,
  speakerCount,
}: {
  eventSlug: string;
  submissionId: string;
  status: SubmissionStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  canDecide: boolean;
  session: { id: string; scheduled: boolean; cancelled: boolean } | null;
  taskCount: number;
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
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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

        {decided && note && (
          <p className="text-sm whitespace-pre-line text-muted-foreground">
            <span className="font-medium text-foreground">Note to speakers: </span>
            {note}
          </p>
        )}

        {session && (
          <p className="text-sm text-muted-foreground" data-testid="decision-session">
            {session.cancelled ? (
              "The session made from this talk has been cancelled."
            ) : (
              <>
                <Link
                  href={`/admin/${eventSlug}/agenda`}
                  className="text-primary underline underline-offset-4"
                >
                  Session created
                </Link>
                {session.scheduled
                  ? " and placed on the agenda."
                  : " — not yet placed on the agenda."}
              </>
            )}
          </p>
        )}

        {taskCount > 0 && (
          <p className="text-sm text-muted-foreground" data-testid="decision-tasks">
            {taskCount} onboarding task{taskCount === 1 ? "" : "s"} assigned across {speakerCount}{" "}
            speaker{speakerCount === 1 ? "" : "s"}.
          </p>
        )}

        {!canDecide ? (
          <p className="text-sm text-muted-foreground">
            An event admin records the final decision. Your recommendation above is what feeds it.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="decision-note">Note to the speakers</Label>
              <Textarea
                id="decision-note"
                rows={3}
                placeholder="Optional — included in the decision email."
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
              <Label htmlFor="decision-notify" className="font-normal">
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
          </>
        )}
      </CardContent>

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
    </Card>
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
