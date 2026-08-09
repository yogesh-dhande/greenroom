"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { requestChanges } from "../actions";

/**
 * "We need one thing from you before we can review this" (spec.md §7).
 *
 * The middle option between accepting and declining: the proposal keeps its
 * status and stays editable in the speaker's portal, and the email tells them
 * exactly what to fix and by when. Sending it decides nothing.
 */
export function RequestChangesDialog({
  eventSlug,
  submissionId,
  hasCoSpeakers,
}: {
  eventSlug: string;
  submissionId: string;
  hasCoSpeakers: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [includeCoSpeakers, setIncludeCoSpeakers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const result = await requestChanges(eventSlug, submissionId, {
        request,
        dueAt,
        includeCoSpeakers,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Change request sent", {
        description: `${result.data.emailsSent} email${result.data.emailsSent === 1 ? "" : "s"} sent.`,
      });
      setOpen(false);
      setRequest("");
      setDueAt("");
      setError(null);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Request changes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>
            Emails the speaker what to fix, with a link to edit their proposal. The submission
            keeps its current status.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-request">What needs changing</Label>
            <Textarea
              id="change-request"
              rows={4}
              placeholder="The abstract is missing the audience takeaways — could you add two or three?"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-due">Due by (optional)</Label>
            <Input
              id="change-due"
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>

          {hasCoSpeakers && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="change-co-speakers"
                checked={includeCoSpeakers}
                onCheckedChange={(value) => setIncludeCoSpeakers(value === true)}
              />
              <Label htmlFor="change-co-speakers" className="font-normal">
                Copy the co-speakers
              </Label>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={send} disabled={isPending}>
            {isPending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
