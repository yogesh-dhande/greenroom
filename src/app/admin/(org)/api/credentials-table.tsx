"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { revokeApiCredential } from "./actions";
import type { ApiCredentialRow, ApiEventOption } from "./types";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  return DATE_FORMAT.format(new Date(value));
}

function EventAccess({ row, events }: { row: ApiCredentialRow; events: ApiEventOption[] }) {
  if (row.eventAccess === "all") {
    return (
      <span className="text-sm text-foreground" title="Includes current and future events">
        All current &amp; future
      </span>
    );
  }

  const namesById = new Map(events.map((event) => [event.id, event.name]));
  const names = row.eventIds.map((id) => namesById.get(id) ?? "Unavailable event");
  const summary =
    names.length <= 2
      ? names.join(", ")
      : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  return (
    <span className="block max-w-56 truncate text-sm text-foreground" title={names.join(", ")}>
      {summary}
    </span>
  );
}

function RevokeButton({ credential }: { credential: ApiCredentialRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      const result = await revokeApiCredential(credential.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(`${credential.label} was revoked`);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Revoke ${credential.label}`}>
          <Trash2Icon aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {credential.label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Any REST or MCP connection using this key will stop working immediately. This can&apos;t
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep key</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              revoke();
            }}
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {pending ? "Revoking…" : "Revoke key"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CredentialsTable({
  credentials,
  events,
}: {
  credentials: ApiCredentialRow[];
  events: ApiEventOption[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Scopes</TableHead>
          <TableHead>Events</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {credentials.map((credential) => (
          <TableRow key={credential.id}>
            <TableCell>
              <span className="block font-medium text-foreground">{credential.label}</span>
              <code className="text-xs text-muted-foreground">{credential.prefix}…</code>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <Badge variant="outline">Read</Badge>
                {credential.permission === "write" ? <Badge variant="outline">Write</Badge> : null}
              </div>
            </TableCell>
            <TableCell>
              <EventAccess row={credential} events={events} />
            </TableCell>
            <TableCell>{formatDate(credential.expiresAt)}</TableCell>
            <TableCell>
              {credential.lastUsedAt ? formatDate(credential.lastUsedAt) : "Never"}
            </TableCell>
            <TableCell>
              <RevokeButton credential={credential} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
