"use client";

import { useState, useTransition } from "react";
import { MailIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendSpeakerPortalInvite } from "../actions";

/**
 * "Send portal invite" on a speaker's record (decisions.md D-070).
 *
 * Re-sending is allowed on purpose — "I don't think that arrived" is the
 * usual reason to press it — and every send is logged with its own
 * `portal_invite` kind, so the Email history card directly below shows what
 * this button did.
 */
export function PortalInviteButton({
  eventSlug,
  speakerId,
  /** Shown in the confirmation copy so it's obvious where mail is going. */
  speakerEmail,
  /** True once an invitation has already gone to this address. */
  alreadyInvited,
}: {
  eventSlug: string;
  speakerId: string;
  speakerEmail: string;
  alreadyInvited: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await sendSpeakerPortalInvite(eventSlug, speakerId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.message);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={send}>
        <MailIcon />
        {isPending ? "Sending…" : alreadyInvited ? "Send portal invite again" : "Send portal invite"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {alreadyInvited
          ? `An invitation has already gone to ${speakerEmail}. Sending again is safe — it's the same magic-link sign-in, not a one-time token.`
          : `Emails ${speakerEmail} a link to their portal. There's no password — they sign in with a magic link.`}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
