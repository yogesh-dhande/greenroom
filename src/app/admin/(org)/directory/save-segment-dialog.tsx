"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { saveSegment } from "./actions";
import type { DirectoryFilterValues } from "./types";

const formSchema = z.object({
  name: z.string().trim().min(1, "Give the segment a name"),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * "Save segment" (spec.md "Org-level speaker CRM": a filtered directory view
 * saves under a name as a dynamic segment and reopens with its current
 * matches).
 *
 * Disabled until something is actually filtered, because a segment matching
 * everyone is a second name for "the directory". The copy states the dynamic
 * contract outright — what's saved is the criteria, not a frozen member list
 * — since that is the difference an organizer needs to know before they name
 * it and rely on it months later.
 */
export function SaveSegmentDialog({
  filter,
  criteria,
  matchCount,
}: {
  filter: DirectoryFilterValues;
  /** "Company contains Northwind - tag ai" — the criteria in plain words. */
  criteria: string;
  /** How many contacts match right now, for the dialog's reassurance line. */
  matchCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const hasFilter = Boolean(filter.q || filter.company || filter.tag);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: { name: "" } });

  async function onSubmit(values: FormValues) {
    const result = await saveSegment({ name: values.name, filter });
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    setOpen(false);
    reset({ name: "" });
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset({ name: "" });
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!hasFilter}>
          Save segment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save segment</DialogTitle>
          <DialogDescription>
            A dynamic segment: this saves the criteria, not the list. Matches update as contacts
            change, so reopening it always shows who fits today.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="segment-name">Segment name</Label>
            <Input id="segment-name" placeholder="AI Experts" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Criteria
            </p>
            <p className="mt-1 text-sm text-foreground">{criteria}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {matchCount} {matchCount === 1 ? "contact matches" : "contacts match"} right now.
            </p>
          </div>

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save segment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
