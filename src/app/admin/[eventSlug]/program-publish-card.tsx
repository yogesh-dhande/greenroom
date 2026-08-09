"use client";

import { useState, useTransition } from "react";
import { GlobeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";
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
import { setProgramPublished } from "./actions";

/**
 * Publish / unpublish the attendee-facing program (decisions.md D-056).
 * Rendered on the event overview for admins only — a reviewer never sees it.
 *
 * Both directions are confirmed: publishing announces a schedule to the
 * public, and unpublishing takes a live program down mid-conference. Neither
 * should happen on a stray click.
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

  function confirm() {
    startTransition(async () => {
      const result = await setProgramPublished(eventSlug, !published);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(published ? "Program unpublished" : "Program published");
      setConfirming(false);
    });
  }

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
            <AlertDialogDescription>
              {published
                ? "The public schedule, speaker gallery, embeds, and feeds go back to a coming-soon state. You can publish again at any time."
                : "The schedule and speaker gallery as they stand right now become public, including embeds and feeds. You can unpublish again at any time."}
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
