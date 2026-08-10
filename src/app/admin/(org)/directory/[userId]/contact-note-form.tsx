"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addContactNote } from "../actions";

/**
 * The composer for a contact's org-level internal notes (spec.md "Org-level
 * speaker CRM": internal notes that persist across events).
 *
 * Append-only: each note is its own dated entry rather than one field the
 * next organizer overwrites, so "shortlist for keynote" written last year is
 * still legible next to "declined 2027, ask again later". The list itself is
 * rendered by the server component above this — only the write needs a
 * client.
 */
export function ContactNoteForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const value = body.trim();
    if (value === "") return;
    startTransition(async () => {
      const result = await addContactNote({ userId, body: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBody("");
      toast.success(result.data.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="contact-note">Internal note</Label>
      <Textarea
        id="contact-note"
        rows={3}
        value={body}
        placeholder="Met at DevFlow 2026 — strong on CI topics; shortlist for keynote."
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={isPending || body.trim() === ""}
          onClick={submit}
        >
          {isPending ? "Saving…" : "Add note"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Only your team sees these — never the contact.
        </p>
      </div>
    </div>
  );
}
