"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { renameTeammate } from "./actions";
import type { TeamMemberRow } from "./types";

/**
 * Fixes a teammate's display name — the seeded/self-chosen name shown
 * everywhere else in the admin area (submissions, reviews, comms) with no
 * other way for an admin to correct a typo or a placeholder on someone
 * else's behalf. Mirrors `ReviewerTracksDialog`'s small-dialog shape.
 */
export function EditNameDialog({
  eventSlug,
  member,
  trigger,
}: {
  eventSlug: string;
  member: TeamMemberRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(member.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await renameTeammate(eventSlug, { userId: member.id, name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.data.message);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          // Reopening should show what's saved, not what was abandoned.
          setName(member.name ?? "");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit name</DialogTitle>
          <DialogDescription>
            How {member.email} is credited across the admin area — submissions, reviews, and
            comms. They can also set this themselves from their own profile once they sign in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`name-${member.id}`}>Name</Label>
          <Input
            id={`name-${member.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            maxLength={120}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save name"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
