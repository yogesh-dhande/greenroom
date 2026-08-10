"use client";

import { useEffect, useState, useTransition } from "react";
import { GlobeIcon, EyeOffIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { describeProgramPublishPlan, type ProgramPublishPlan } from "@/domain/program";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { getProgramPublishPlan, setProgramPublished } from "./actions";

/**
 * Publish / unpublish the attendee-facing program (decisions.md D-056).
 * Rendered on the event overview for admins only — a reviewer never sees it.
 *
 * Both directions are confirmed: publishing announces a schedule to the
 * public, and unpublishing takes a live program down mid-conference. Neither
 * should happen on a stray click.
 *
 * Held-back visibility (bug fix): scheduled sessions whose content status
 * isn't `approved` never make it to the public schedule (D-072), but publish
 * used to say nothing about it — an admin saw a scheduled-session count that
 * disagreed with what attendees got, with no warning either way. The plan
 * fetched here (src/domain/program.ts `planProgramPublish`) is shown both
 * before publishing (in the confirm dialog, so it's not a surprise) and
 * after (in the card body, so it doesn't stay a secret once it's live).
 */
export function ProgramPublishCard({
  eventSlug,
  published,
}: {
  eventSlug: string;
  published: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [plan, setPlan] = useState<ProgramPublishPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProgramPublishPlan(eventSlug).then((result) => {
      if (!cancelled && result.ok) setPlan(result.plan);
    });
    return () => {
      cancelled = true;
    };
  }, [eventSlug]);

  function confirm() {
    startTransition(async () => {
      const result = await setProgramPublished(eventSlug, !published);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPlan(result.plan);
      if (!published && result.plan.heldBack.length > 0) {
        // Publishing, with something excluded — the success toast repeats
        // the same held-back call-out as the dialog, so it's still visible
        // even if the organizer skimmed past the confirmation text.
        toast.success(`Program published. ${describeProgramPublishPlan(result.plan)}`);
      } else {
        toast.success(published ? "Program unpublished" : "Program published");
      }
      setConfirming(false);
    });
  }

  const heldBack = plan?.heldBack ?? [];

  return (
    <Card className="mt-6">
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          {published ? (
            <GlobeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <EyeOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">
                {published ? "Program is live" : "Program is not published yet"}
              </p>
              <Badge variant={published ? "default" : "secondary"}>
                {published ? "Published" : "Draft"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {published
                ? "Attendees see the schedule, speakers, embeds, and feeds — every agenda change goes public immediately."
                : "Build the agenda privately; attendees see a coming-soon page until you publish."}
            </p>

            {/* Post-publish (and pre-publish) held-back visibility: stays on
                screen for as long as the condition holds, not just in a toast
                that scrolls away. */}
            {heldBack.length > 0 && (
              <div
                className="mt-2 flex items-start gap-1.5 text-xs text-warning"
                data-testid="publish-held-back-note"
              >
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <p>
                  {published ? "Not on the public program: " : "Won't publish yet: "}
                  {heldBack.map((s) => s.title).join(", ")} ({heldBack.length} scheduled session
                  {heldBack.length === 1 ? "" : "s"} awaiting content sign-off).
                </p>
              </div>
            )}
          </div>
        </div>
        <Button
          variant={published ? "outline" : "default"}
          onClick={() => setConfirming(true)}
          disabled={isPending}
        >
          {published ? "Unpublish program" : "Publish program"}
        </Button>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {published ? "Unpublish the program?" : "Publish the program?"}
            </AlertDialogTitle>
            <AlertDialogDescription data-testid="publish-plan-summary">
              {published
                ? "The public schedule, speaker gallery, embeds, and feeds go back to a coming-soon state. You can publish again at any time."
                : "The schedule and speaker gallery as they stand right now become public, including embeds and feeds. You can unpublish again at any time."}
              {/* The held-back call-out only matters on the way to
                  publishing — unpublishing takes everything down regardless
                  of content status, so there's nothing extra to warn about
                  there. */}
              {!published && plan ? ` ${describeProgramPublishPlan(plan)}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={confirm}>
              {isPending
                ? published
                  ? "Unpublishing…"
                  : "Publishing…"
                : published
                  ? "Unpublish"
                  : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
