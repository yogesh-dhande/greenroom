"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { GroupChips, PickerSearch } from "@/components/people-picker/people-picker";
import { buildGroups, filterByQuery } from "@/components/people-picker/selection";
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
 *
 * The search box and group chips are the recipient picker's, adapted to
 * sessions: on a forty-session agenda "which ones still have nobody's
 * calendar in them" is the same question as "who hasn't been written to", and
 * it deserves the same one click. Nothing here selects — the chips narrow the
 * list, and each row keeps its own send button.
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
  const [query, setQuery] = useState("");
  // The chips filter rather than select, so "which chip is on" is held as the
  // set of session ids it stands for — the same shape the picker's chips use.
  const [narrowed, setNarrowed] = useState<string[]>([]);

  const rows = useMemo(
    () => invites.map((invite) => ({ ...invite, id: invite.sessionId })),
    [invites],
  );

  const groups = useMemo(
    () =>
      buildGroups(rows, [
        { id: "ready", label: "Ready to send", matches: (row) => !row.blockedReason },
        {
          id: "never",
          label: "Never sent",
          matches: (row) => !row.blockedReason && row.sentCount === 0,
        },
        { id: "sent", label: "Already sent", matches: (row) => row.sentCount > 0 },
        {
          id: "blocked",
          label: "Needs a time or a speaker",
          matches: (row) => Boolean(row.blockedReason),
          tone: "warning" as const,
        },
      ]),
    [rows],
  );

  const shown = useMemo(() => {
    const searched = filterByQuery(rows, query, (row) => [
      row.title,
      row.room,
      row.when,
      row.speakers.join(" "),
    ]);
    return narrowed.length === 0
      ? searched
      : searched.filter((row) => narrowed.includes(row.sessionId));
  }, [rows, query, narrowed]);

  const filtering = query.trim().length > 0 || narrowed.length > 0;

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <PickerSearch
          value={query}
          onValueChange={setQuery}
          label="Search sessions"
          placeholder="Title, room, or speaker"
          className="w-64"
        />
        <GroupChips
          groups={groups}
          selected={narrowed}
          onSelectedChange={setNarrowed}
          label="Session groups"
        />
        {filtering ? (
          <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            Showing {shown.length} of {invites.length}
          </p>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No session here matches that."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setNarrowed([]);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((row) => (
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
      )}
    </div>
  );
}
