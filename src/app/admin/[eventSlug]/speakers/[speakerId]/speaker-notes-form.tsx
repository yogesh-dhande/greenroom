"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveSpeakerNotes } from "../actions";

/**
 * The organizer-only logistics field (decisions.md D-051) — "Arrival May 11,
 * aisle seat; dietary: Vegetarian". One free-text box rather than a
 * custom-field builder, and stored per event, so next year's arrangements
 * start blank instead of inheriting last year's.
 */
export function SpeakerNotesForm({
  eventSlug,
  speakerId,
  notes,
}: {
  eventSlug: string;
  speakerId: string;
  notes: string | null;
}) {
  const [value, setValue] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const saved = notes ?? "";

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveSpeakerNotes(eventSlug, { speakerId, notes: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.data.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="speaker-notes" className="sr-only">
          Internal notes
        </Label>
        <Textarea
          id="speaker-notes"
          rows={4}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="e.g. arrival May 11, aisle seat; dietary: Vegetarian"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={isPending || value === saved} onClick={save}>
          {isPending ? "Saving…" : "Save notes"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Only organizers see this — never the speaker, never the public page.
        </p>
      </div>
    </div>
  );
}
