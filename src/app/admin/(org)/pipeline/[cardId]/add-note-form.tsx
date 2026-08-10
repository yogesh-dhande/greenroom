"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addContactNote } from "../actions";

/**
 * The internal-note composer on a pipeline card (spec.md "Org-level speaker
 * CRM", D-077).
 *
 * Notes are append-only and org-level: they belong to the contact, not to the
 * card or to any one event, so the same list appears on the contact profile.
 * The textarea clears on success and the server revalidation re-renders the
 * list above it, which is why there is no optimistic entry here.
 */
export function AddNoteForm({ cardId }: { cardId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addContactNote({ cardId, body });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setBody("");
      toast.success(result.data.message);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="contact-note">Add note</Label>
      <Textarea
        id="contact-note"
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Left voicemail; follow up next week."
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button
          type="button"
          size="sm"
          disabled={isPending || body.trim() === ""}
          onClick={submit}
        >
          {isPending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
