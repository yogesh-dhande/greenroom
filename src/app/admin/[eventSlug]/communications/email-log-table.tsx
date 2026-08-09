"use client";

import { useMemo, useState } from "react";
import type { EmailKind } from "@/db/entities";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EMAIL_KIND_LABELS, LOG_KIND_ORDER, type LogRow, type SpeakerOption } from "./types";

const ALL = "__all__";

/**
 * The communication log (spec.md §7 — "communication log per speaker").
 *
 * Filtering is client-side over rows already fetched: an event's whole
 * correspondence is hundreds of rows at most, and a filter that responds on
 * keypress rather than on a round trip is the difference between a tool an
 * organizer uses to answer "did we ever tell her about the room change?" and
 * one they don't.
 *
 * The speaker filter is what makes this "per speaker" — it keys on the email
 * address rather than the user id, because the log records addresses so it
 * survives a speaker never claiming their account.
 */
export function EmailLogTable({
  rows,
  speakers,
}: {
  rows: LogRow[];
  speakers: SpeakerOption[];
}) {
  const [recipient, setRecipient] = useState<string>(ALL);
  const [kind, setKind] = useState<string>(ALL);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (recipient !== ALL && row.to.toLowerCase() !== recipient.toLowerCase()) return false;
        if (kind !== ALL && row.kind !== kind) return false;
        return true;
      }),
    [rows, recipient, kind],
  );

  // Only offer kinds that actually occur — an empty filter result the user
  // chose from a dropdown reads as a bug.
  const presentKinds = useMemo(() => {
    const present = new Set(rows.map((row) => row.kind));
    return LOG_KIND_ORDER.filter((candidate) => present.has(candidate));
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={recipient} onValueChange={setRecipient}>
          <SelectTrigger className="w-[260px]" aria-label="Filter by speaker">
            <SelectValue placeholder="Everyone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Everyone</SelectItem>
            {speakers.map((speaker) => (
              <SelectItem key={speaker.id} value={speaker.email}>
                {speaker.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-[200px]" aria-label="Filter by message type">
            <SelectValue placeholder="All message types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All message types</SelectItem>
            {presentKinds.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {EMAIL_KIND_LABELS[candidate]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-sm text-muted-foreground">
          {visible.length === rows.length
            ? `${rows.length} message${rows.length === 1 ? "" : "s"}`
            : `${visible.length} of ${rows.length}`}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          description="Confirmations, decisions, reminders and calendar invites all land here as they go out."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No messages match"
          description="Nothing has been sent to that person with that message type."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sent</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  <time dateTime={row.sentAt}>{row.sentAtLabel}</time>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">{row.toName ?? row.to}</span>
                    {row.toName ? (
                      <span className="text-xs text-muted-foreground">{row.to}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{EMAIL_KIND_LABELS[row.kind as EmailKind]}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-foreground">{row.subject}</span>
                    {row.context ? (
                      <span className="text-xs text-muted-foreground">{row.context}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  {row.status === "sent" ? (
                    <span className="text-muted-foreground">Sent</span>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-destructive bg-destructive/10 text-destructive"
                      title={row.error ?? undefined}
                    >
                      Failed
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
