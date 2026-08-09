"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { FormType } from "@/db/entities";
import { FORM_TYPE_DESCRIPTIONS, FORM_TYPE_LABELS } from "@/domain/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createForm } from "./actions";

/** Creating a form asks for one thing — what to call it — and drops the
 * organizer straight into the builder with a working standard CFP. */
export function NewFormButton({ eventSlug }: { eventSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Call for Speakers");
  const [type, setType] = useState<FormType>("abstract");
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          New form
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await createForm(eventSlug, name, type);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              setOpen(false);
              router.push(`/admin/${eventSlug}/forms/${result.data.formId}`);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New form</DialogTitle>
            <DialogDescription>
              Starts with the standard call-for-speakers questions — a title, an abstract, tracks,
              and speaker info. Edit anything you like before publishing.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="new-form-name">Form name</Label>
            <Input
              id="new-form-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Speakers see this at the top of the form.
            </p>

            {/* What submissions become (decisions.md D-041) — chosen up front
             * because it decides whether this form feeds the review queue. */}
            <Label htmlFor="new-form-type" className="mt-2">
              Submissions become
            </Label>
            <Select value={type} onValueChange={(value) => setType(value as FormType)}>
              <SelectTrigger id="new-form-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORM_TYPE_LABELS) as FormType[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {FORM_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{FORM_TYPE_DESCRIPTIONS[type]}</p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Creating…" : "Create form"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
