"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SpeakerConfirmation } from "@/db/entities";
import { Button } from "@/components/ui/button";
import { setSpeakerConfirmation } from "../actions";

/** The three states an organizer can put a speaker in — the stored pair,
 * plus the unset one that keeps deriving (decisions.md D-068). `null` can't
 * be a button value, so "automatic" stands in for it here and is mapped back
 * before the call. */
type Choice = "automatic" | SpeakerConfirmation;

/**
 * The organizer's confirmation control (decisions.md D-068).
 *
 * "Automatic" is not a third stored status — it is the *absence* of one, and
 * it's what every speaker starts as: the answer then comes from whether
 * they're attached to a session, exactly as it did before this control
 * existed. The button says what automatic currently resolves to, so choosing
 * it is never a guess. Setting Confirmed or Declined stores a value that
 * wins over that derivation on the roster, in the confirmation filter, and
 * in the badge above.
 *
 * Each button applies immediately: with three mutually exclusive states, a
 * click is already the explicit intent a separate Save button would be
 * confirming.
 */
export function SpeakerConfirmationForm({
  eventSlug,
  speakerId,
  confirmationStatus,
  derivedConfirmed,
}: {
  eventSlug: string;
  speakerId: string;
  /** What's stored today; null means automatic. */
  confirmationStatus: SpeakerConfirmation | null;
  /** What automatic resolves to right now — attached to a session or not. */
  derivedConfirmed: boolean;
}) {
  const [choice, setChoice] = useState<Choice>(confirmationStatus ?? "automatic");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options: Array<{ value: Choice; label: string }> = [
    {
      value: "automatic",
      label: `Automatic (currently ${derivedConfirmed ? "Confirmed" : "Not confirmed"})`,
    },
    { value: "confirmed", label: "Confirmed" },
    { value: "declined", label: "Declined" },
  ];

  function apply(next: Choice) {
    if (next === choice || isPending) return;
    const previous = choice;
    setChoice(next);
    setError(null);
    startTransition(async () => {
      const result = await setSpeakerConfirmation(eventSlug, {
        speakerId,
        confirmation: next === "automatic" ? null : next,
      });
      if (!result.ok) {
        // Put the control back where it was: the server refused, so the
        // stored value is still the old one.
        setChoice(previous);
        setError(result.error);
        return;
      }
      toast.success(result.data.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={option.value === choice ? "default" : "outline"}
            aria-pressed={option.value === choice}
            disabled={isPending}
            onClick={() => apply(option.value)}
            className="justify-start"
          >
            {option.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <p className="text-sm text-muted-foreground">
        {choice === "automatic"
          ? "Follows their sessions: confirmed once they're on one of this event's sessions."
          : "Set by you — this overrides whatever their sessions say."}
      </p>
    </div>
  );
}
