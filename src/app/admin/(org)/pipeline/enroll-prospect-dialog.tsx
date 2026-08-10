"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DEFAULT_PIPELINE_STAGE, PIPELINE_STAGES, PIPELINE_STAGE_LABELS } from "@/domain/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ActionTimeoutError,
  withActionTimeout,
} from "@/app/admin/[eventSlug]/speakers/action-timeout";
import { enrollProspect } from "./actions";

/** One option in the contact picker — resolved server-side so the dialog
 * never has to know what a `DirectoryContact` is. */
export interface EnrollCandidate {
  userId: string;
  /** "Ada Lovelace (ada@example.com)" — name plus the address that
   * disambiguates two people who share one. */
  label: string;
}

/**
 * Score is typed, so it travels as a string and is validated as one: an empty
 * box means "unscored", not zero, and `valueAsNumber` on an empty number input
 * yields NaN, which no numeric schema can tell apart from a typo.
 */
const formSchema = z.object({
  userId: z.string().min(1, "Pick a contact"),
  stage: z.string().min(1, "Pick a stage"),
  score: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || (/^\d{1,3}$/.test(value) && Number(value) <= 100),
      "Score must be a whole number from 0 to 100",
    ),
  rationale: z.string().trim().max(2000, "Keep the rationale under 2000 characters"),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY: FormValues = {
  userId: "",
  stage: DEFAULT_PIPELINE_STAGE,
  score: "",
  rationale: "",
};

/**
 * "Add prospect" (spec.md "Org-level speaker CRM", D-077): puts a contact who
 * already exists in the org directory onto the sourcing board, with the
 * optional fit score and rationale the board card and detail view show.
 *
 * The picker only offers contacts who are *not* already on the board, so the
 * one-card-per-contact rule shows up as an absent option rather than as an
 * error after submitting. The action still re-checks — the list was rendered
 * at page load, and another organizer may have enrolled someone since.
 */
export function EnrollProspectDialog({ candidates }: { candidates: EnrollCandidate[] }) {
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });

  async function onSubmit(values: FormValues) {
    let result;
    try {
      result = await withActionTimeout(
        enrollProspect({
          userId: values.userId,
          stage: values.stage,
          score: values.score === "" ? null : Number(values.score),
          rationale: values.rationale === "" ? null : values.rationale,
        }),
      );
    } catch (error) {
      if (error instanceof ActionTimeoutError) {
        const message =
          "The server didn't respond. Check the board before trying again — the prospect may have been added.";
        setError("root", { message });
        toast.error(message);
        return;
      }
      throw error;
    }
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    setOpen(false);
    reset(EMPTY);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Add prospect</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add prospect</DialogTitle>
          <DialogDescription>
            Enroll someone from the contact directory onto the sourcing board. Score and
            rationale are optional notes to your future self.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prospect-contact">Contact</Label>
            {candidates.length > 0 ? (
              <NativeSelect
                id="prospect-contact"
                className="h-9 w-80 max-w-full"
                {...register("userId")}
              >
                <option value="">Select a contact…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.userId} value={candidate.userId}>
                    {candidate.label}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every contact in the directory is already on the board. Add someone to the
                directory first.
              </p>
            )}
            {errors.userId && (
              <p className="text-sm text-destructive">{errors.userId.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prospect-stage">Stage</Label>
              <NativeSelect id="prospect-stage" className="h-9 w-44" {...register("stage")}>
                {PIPELINE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {PIPELINE_STAGE_LABELS[stage]}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prospect-score">Score (optional)</Label>
              <Input
                id="prospect-score"
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                placeholder="85"
                {...register("score")}
              />
              {errors.score && (
                <p className="text-sm text-destructive">{errors.score.message}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prospect-rationale">Rationale (optional)</Label>
            <Textarea
              id="prospect-rationale"
              rows={3}
              placeholder="Why this person, and why now."
              {...register("rationale")}
            />
            {errors.rationale && (
              <p className="text-sm text-destructive">{errors.rationale.message}</p>
            )}
          </div>

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting || candidates.length === 0}>
              {isSubmitting ? "Adding…" : "Add prospect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
