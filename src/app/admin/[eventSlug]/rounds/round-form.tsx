"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { ReviewRound, ScorecardCriterion, ScorecardCriterionType } from "@/db/entities";
import { toZonedInputValue } from "@/domain/forms";
import { SCORECARD_WOULD_BE_DELETED } from "@/domain/rounds";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createRound, deleteRound, updateRound, type RoundInput } from "./actions";

/**
 * Create/edit one review round and its scorecard (spec.md "Important" —
 * multi-round scored evaluations; rubric ABS-01/ABS-03/ABS-04).
 *
 * Everything is local state until Save, like the CFP form builder: an organizer
 * designing a scorecard adds four criteria and fixes two labels before they
 * mean anything by it, and a round trip per keystroke would only get in the way.
 */

const TYPE_LABEL: Record<ScorecardCriterionType, string> = {
  number: "Rating (number)",
  select: "Dropdown",
  text: "Free text",
};

interface CriterionDraft {
  /** React key only — never sent to the server. */
  key: string;
  id?: string;
  label: string;
  type: ScorecardCriterionType;
  helpText: string;
  min: string;
  max: string;
  weight: string;
  /** Comma-separated dropdown choices, as typed. */
  options: string;
}

function toDraft(criterion: ScorecardCriterion, index: number): CriterionDraft {
  return {
    key: `${criterion.id}-${index}`,
    id: criterion.id,
    label: criterion.label,
    type: criterion.type,
    helpText: criterion.helpText ?? "",
    min: criterion.min === undefined ? "" : String(criterion.min),
    max: criterion.max === undefined ? "" : String(criterion.max),
    weight: criterion.weight === undefined ? "" : String(criterion.weight),
    options: (criterion.options ?? []).join(", "),
  };
}

function blankDraft(type: ScorecardCriterionType): CriterionDraft {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    type,
    helpText: "",
    min: type === "number" ? "1" : "",
    max: type === "number" ? "5" : "",
    weight: type === "number" ? "1" : "",
    options: "",
  };
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function RoundForm({
  eventSlug,
  eventTimezone,
  round,
  criteriaLocked = false,
}: {
  eventSlug: string;
  eventTimezone: string;
  /** Absent when creating. */
  round?: ReviewRound;
  /**
   * Set once any reviewer has filed a scorecard: the criteria are then the
   * questions those answers were given to, and freezing them is what lets a
   * filed scorecard read back verbatim (decisions.md D-060, the lock pattern
   * from D-042). Everything else about the round stays editable.
   */
  criteriaLocked?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(round?.name ?? "");
  const [description, setDescription] = useState(round?.description ?? "");
  const [opensAt, setOpensAt] = useState(toZonedInputValue(round?.opensAt ?? null, eventTimezone));
  const [closesAt, setClosesAt] = useState(
    toZonedInputValue(round?.closesAt ?? null, eventTimezone),
  );
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() =>
    round ? round.criteria.map(toDraft) : [blankDraft("number")],
  );
  // Blind review is per round and off unless the organizer asks for it
  // (decisions.md D-049).
  const [blindReview, setBlindReview] = useState(round?.blindReview ?? false);
  const [isSaving, startSaving] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function patch(key: string, changes: Partial<CriterionDraft>) {
    setCriteria((rows) => rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function addCriterion(type: ScorecardCriterionType) {
    setCriteria((rows) => [...rows, blankDraft(type)]);
  }

  function save() {
    const input: RoundInput = {
      name,
      description,
      opensAt,
      closesAt,
      blindReview,
      criteria: criteria.map((row) => ({
        id: row.id,
        label: row.label,
        type: row.type,
        helpText: row.helpText,
        min: numberOrUndefined(row.min),
        max: numberOrUndefined(row.max),
        weight: numberOrUndefined(row.weight),
        options: row.options
          .split(",")
          .map((option) => option.trim())
          .filter(Boolean),
      })),
    };

    startSaving(async () => {
      const result = round
        ? await updateRound(eventSlug, round.id, input)
        : await createRound(eventSlug, input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(round ? "Round saved" : "Round created");
      router.push(`/admin/${eventSlug}/rounds/${result.roundId}/assignments`);
      router.refresh();
    });
  }

  /**
   * Deletes the round, escalating to a confirmation when the server reports the
   * round still holds filed scorecards — deleting it cascades through every
   * assignment and every score on them (decisions.md D-095).
   */
  function remove(confirmed = false) {
    if (!round) return;
    startDeleting(async () => {
      const result = await deleteRound(eventSlug, round.id, confirmed);
      if (!result.ok) {
        if ("code" in result && result.code === SCORECARD_WOULD_BE_DELETED) {
          setConfirmingDelete(true);
          return;
        }
        toast.error(result.error);
        return;
      }
      setConfirmingDelete(false);
      toast.success("Round deleted");
      router.push(`/admin/${eventSlug}/rounds`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="round-name">Round name</Label>
          <Input
            id="round-name"
            placeholder="Initial Review"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="round-description">What this round is for (optional)</Label>
          <Textarea
            id="round-description"
            rows={2}
            placeholder="First pass — everything that isn't clearly off-topic goes through."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="round-opens">Opens</Label>
            <Input
              id="round-opens"
              type="datetime-local"
              value={opensAt}
              onChange={(event) => setOpensAt(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="round-closes">Closes</Label>
            <Input
              id="round-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(event) => setClosesAt(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Times are in the event&apos;s timezone ({eventTimezone}). Reviewers can only score while
          the round is open.
        </p>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Hide speaker identity</p>
            <p className="text-sm text-muted-foreground">
              Blind review: reviewers in this round see the proposal without names, emails, bios,
              headshots or co-speakers. Your own results and submission pages are unaffected.
            </p>
          </div>
          <Switch
            aria-label="Hide speaker identity"
            checked={blindReview}
            onCheckedChange={setBlindReview}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Scorecard</h2>
          <p className="text-sm text-muted-foreground">
            What every reviewer answers about each submission in this round. Ratings carry a weight
            and feed the aggregate score; dropdowns and free text are recorded for you to read.
          </p>
        </div>

        {criteriaLocked ? (
          <p className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
            Reviewers have already filed scorecards in this round, so the scorecard is locked —
            scores on file have to read back exactly as they were entered. The round&apos;s name,
            dates and blind-review setting are still editable; to score on different criteria,
            create a new round.
          </p>
        ) : null}

        {criteria.map((row, index) => (
          <div key={row.key} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex items-start gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={`criterion-label-${index}`}>Criterion</Label>
                <Input
                  id={`criterion-label-${index}`}
                  placeholder="Originality"
                  disabled={criteriaLocked}
                  value={row.label}
                  onChange={(event) => patch(row.key, { label: event.target.value })}
                />
              </div>
              <div className="flex w-44 flex-col gap-1.5">
                <Label htmlFor={`criterion-type-${index}`}>Type</Label>
                <Select
                  value={row.type}
                  disabled={criteriaLocked}
                  onValueChange={(value) =>
                    patch(row.key, { type: value as ScorecardCriterionType })
                  }
                >
                  <SelectTrigger id={`criterion-type-${index}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as ScorecardCriterionType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {TYPE_LABEL[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="mt-6"
                aria-label={`Remove ${row.label || "criterion"}`}
                disabled={criteriaLocked}
                onClick={() => setCriteria((rows) => rows.filter((other) => other.key !== row.key))}
              >
                <Trash2Icon />
              </Button>
            </div>

            {row.type === "number" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`criterion-min-${index}`}>Lowest</Label>
                  <Input
                    id={`criterion-min-${index}`}
                    type="number"
                    disabled={criteriaLocked}
                    value={row.min}
                    onChange={(event) => patch(row.key, { min: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`criterion-max-${index}`}>Highest</Label>
                  <Input
                    id={`criterion-max-${index}`}
                    type="number"
                    disabled={criteriaLocked}
                    value={row.max}
                    onChange={(event) => patch(row.key, { max: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`criterion-weight-${index}`}>Weight</Label>
                  <Input
                    id={`criterion-weight-${index}`}
                    type="number"
                    step="0.5"
                    disabled={criteriaLocked}
                    value={row.weight}
                    onChange={(event) => patch(row.key, { weight: event.target.value })}
                  />
                </div>
              </div>
            ) : null}

            {row.type === "select" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`criterion-options-${index}`}>Choices</Label>
                <Input
                  id={`criterion-options-${index}`}
                  placeholder="Accept, Maybe, Decline"
                  disabled={criteriaLocked}
                  value={row.options}
                  onChange={(event) => patch(row.key, { options: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">Separate choices with commas.</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`criterion-help-${index}`}>Guidance for reviewers (optional)</Label>
              <Input
                id={`criterion-help-${index}`}
                disabled={criteriaLocked}
                value={row.helpText}
                onChange={(event) => patch(row.key, { helpText: event.target.value })}
              />
            </div>
          </div>
        ))}

        {criteriaLocked ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => addCriterion("number")}>
              <PlusIcon /> Add rating
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addCriterion("select")}>
              <PlusIcon /> Add dropdown
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addCriterion("text")}>
              <PlusIcon /> Add free text
            </Button>
          </div>
        )}
      </section>

      <Separator />

      <div className="flex items-center justify-between gap-3">
        <Button type="button" onClick={save} disabled={isSaving}>
          {isSaving ? "Saving…" : round ? "Save round" : "Create round"}
        </Button>
        {round ? (
          <Button type="button" variant="ghost" onClick={() => remove()} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete round"}
          </Button>
        ) : null}
      </div>
      <AlertDialog open={confirmingDelete} onOpenChange={(open) => !open && setConfirmingDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this round and its scorecards?</AlertDialogTitle>
            <AlertDialogDescription>
              Reviewers have already filed scorecards in {round?.name ?? "this round"}. Deleting the
              round deletes every one of them, along with its assignments and results. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Keep the round</AlertDialogCancel>
            <AlertDialogAction disabled={isDeleting} onClick={() => remove(true)}>
              {isDeleting ? "Deleting…" : "Delete round and scorecards"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
