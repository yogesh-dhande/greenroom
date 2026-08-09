"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ScorecardCriterion } from "@/db/entities";
import { criterionRange, validateScorecard } from "@/domain/rounds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Aliased rather than relative: the submission record renders this same form
// from a different depth in the tree (decisions.md D-048).
import { recuseFromSubmission, submitScorecard } from "@/app/admin/[eventSlug]/rounds/actions";

/**
 * Fills in one round's scorecard for one submission (rubric ABS-03: ratings,
 * dropdowns and free text all render and all store their value).
 *
 * The same criteria array that the organizer built drives this form, so a round
 * that asks four questions gets four controls with no code change — the D-009
 * approach for CFP forms, applied to scorecards.
 */
export function ScorecardForm({
  eventSlug,
  roundId,
  submissionId,
  criteria,
  values,
  submitted,
  recused,
  recusalReason,
  canScore,
  returnTo,
}: {
  eventSlug: string;
  roundId: string;
  submissionId: string;
  criteria: ScorecardCriterion[];
  values: Record<string, unknown>;
  submitted: boolean;
  recused: boolean;
  recusalReason: string | null;
  /** False when the round isn't open — the form reads but doesn't submit. */
  canScore: boolean;
  /** Where filing lands the reviewer; their queue unless the page says otherwise. */
  returnTo?: string;
}) {
  const router = useRouter();
  const done = returnTo ?? `/admin/${eventSlug}/rounds/${roundId}/score`;
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const criterion of criteria) {
      const raw = values[criterion.id];
      initial[criterion.id] = raw === undefined || raw === null ? "" : String(raw);
    }
    return initial;
  });
  const [reason, setReason] = useState(recusalReason ?? "");
  const [showRecuse, setShowRecuse] = useState(false);
  const [isSaving, startSaving] = useTransition();

  function set(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }));
  }

  function save() {
    const payload: Record<string, unknown> = {};
    for (const criterion of criteria) {
      const raw = answers[criterion.id] ?? "";
      payload[criterion.id] = criterion.type === "number" ? (raw === "" ? null : Number(raw)) : raw;
    }
    // Same check the server runs, just sooner — the server's is the one that counts.
    const problem = validateScorecard(criteria, payload);
    if (problem) {
      toast.error(problem);
      return;
    }

    startSaving(async () => {
      const result = await submitScorecard(eventSlug, roundId, submissionId, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Scorecard submitted");
      router.push(done);
      router.refresh();
    });
  }

  function recuse() {
    startSaving(async () => {
      const result = await recuseFromSubmission(eventSlug, roundId, submissionId, reason);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Conflict recorded — this one's off your list");
      router.push(done);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {recused ? (
        <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          You declared a conflict on this submission
          {recusalReason ? `: ${recusalReason}` : ""}. It no longer counts towards your queue —
          scoring it anyway will put it back.
        </p>
      ) : null}
      {!canScore ? (
        <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          This round isn&apos;t open right now, so scores can&apos;t be filed.
        </p>
      ) : null}

      <div className="flex flex-col gap-5">
        {criteria.map((criterion) => {
          const inputId = `criterion-${criterion.id}`;
          const range = criterionRange(criterion);
          return (
            <div key={criterion.id} className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>
                {criterion.label}
                {criterion.type === "number" ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({range.min}–{range.max}
                    {criterion.weight && criterion.weight !== 1 ? `, weight ${criterion.weight}` : ""}
                    )
                  </span>
                ) : null}
              </Label>
              {criterion.helpText ? (
                <p className="text-xs text-muted-foreground">{criterion.helpText}</p>
              ) : null}

              {criterion.type === "number" ? (
                <Input
                  id={inputId}
                  type="number"
                  min={range.min}
                  max={range.max}
                  className="w-32"
                  value={answers[criterion.id] ?? ""}
                  onChange={(event) => set(criterion.id, event.target.value)}
                />
              ) : criterion.type === "select" ? (
                <Select
                  value={answers[criterion.id] ?? ""}
                  onValueChange={(value) => set(criterion.id, value)}
                >
                  <SelectTrigger id={inputId} className="w-full sm:w-72">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(criterion.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Textarea
                  id={inputId}
                  rows={4}
                  value={answers[criterion.id] ?? ""}
                  onChange={(event) => set(criterion.id, event.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" onClick={save} disabled={isSaving || !canScore}>
          {isSaving ? "Saving…" : submitted ? "Update scorecard" : "Submit scorecard"}
        </Button>
        {recused ? null : (
          <Button type="button" variant="ghost" onClick={() => setShowRecuse((open) => !open)}>
            Declare a conflict of interest
          </Button>
        )}
      </div>

      {showRecuse && !recused ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <Label htmlFor="recusal-reason">Why you can&apos;t review this one (optional)</Label>
          <Input
            id="recusal-reason"
            placeholder="I work with the speaker"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The organizer sees this on the round&apos;s progress view, and the submission stops
            counting towards your queue.
          </p>
          <div>
            <Button type="button" variant="outline" onClick={recuse} disabled={isSaving}>
              Recuse me from this submission
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
