"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { sendSessionInvite } from "./actions";
import type { InviteRow } from "./types";

/**
 * Calendar invitations, session by session (spec.md §7, decisions.md D-020).
 *
 * Re-sending is a first-class button rather than a hidden repair: the invite
 * usually goes out before the room is assigned, and again after the room
 * changes. Greenroom keeps the same UID and raises SEQUENCE, so the second
 * one updates the entry already sitting in the speaker's calendar instead of
 * adding a duplicate — which is why the button says "Re-send" and not
 * "Send again (careful)".
 *
 * Sessions that can't be invited on yet are listed too, with the reason:
 * "nothing here" is a worse answer than "this one needs a time first".
 */
export function InvitesPanel({
  eventSlug,
  invites,
}: {
  eventSlug: string;
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startSend] = useTransition();

  if (invites.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Accept a submission and place it on the agenda, then invitations can go out."
      />
    );
  }

  function send(row: InviteRow) {
    setPendingId(row.sessionId);
    startSend(async () => {
      const result = await sendSessionInvite(eventSlug, row.sessionId);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { sent, failed, sequence } = result.data;
      if (sent === 0) {
        toast.error("No invitation went out", {
          description: failed > 0 ? "The send failed — check the log." : "Nobody to invite.",
        });
        return;
      }
      toast.success(
        sequence > 0
          ? `Updated invitation sent to ${sent} ${sent === 1 ? "speaker" : "speakers"}`
          : `Invitation sent to ${sent} ${sent === 1 ? "speaker" : "speakers"}`,
        {
          description:
            sequence > 0
              ? "Their existing calendar entry updates in place."
              : "It'll appear in their calendar as an invitation to accept.",
        },
      );
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col gap-3">
      {invites.map((row) => (
        <li
          key={row.sessionId}
          className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border p-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{row.title}</span>
              {row.sentCount > 0 ? (
                <Badge variant="outline">
                  {row.sentCount === 1 ? "1 invite sent" : `${row.sentCount} invites sent`}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {[row.when ?? "Not scheduled", row.room ?? "No room", row.speakers.join(", ")]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {row.lastSentLabel ? (
              <p className="text-xs text-muted-foreground">Last sent {row.lastSentLabel}</p>
            ) : null}
            {row.blockedReason ? (
              <p className="text-sm text-warning">{row.blockedReason}</p>
            ) : null}
          </div>

          <Button
            variant={row.sentCount > 0 ? "outline" : "default"}
            onClick={() => send(row)}
            disabled={Boolean(row.blockedReason) || pendingId === row.sessionId}
          >
            <CalendarPlusIcon />
            {pendingId === row.sessionId
              ? "Sending…"
              : row.sentCount > 0
                ? "Re-send invitation"
                : "Send invitation"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
