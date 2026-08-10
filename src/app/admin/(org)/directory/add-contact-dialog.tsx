"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { addContact } from "./actions";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.email("Enter a valid email address"),
  title: z.string().trim().optional(),
  company: z.string().trim().optional(),
  bio: z.string().trim().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const EMPTY: FormValues = { name: "", email: "", title: "", company: "", bio: "" };

/**
 * Manual "Add contact" for the org directory (spec.md "Org-level speaker
 * CRM"): a prospect nobody has invited to an event yet — met at a conference,
 * recommended by a colleague — entered before there is any event to attach
 * them to.
 *
 * Deduplicates by address like the roster's own add does: an address with an
 * account that isn't in the directory yet joins it rather than forking a
 * second person (the toast says so), but an address already in the directory
 * is rejected outright — email is this app's identity key (decisions.md
 * D-051), so the same contact can't be added twice. A shared *name* under a
 * different email is a softer case (decisions.md D-059): it still creates
 * the contact, with a flash note that a possible duplicate now exists.
 */
export function AddContactDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /** Set when the add was refused because the address is already a contact. */
  const [duplicateUserId, setDuplicateUserId] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });

  async function onSubmit(values: FormValues) {
    setDuplicateUserId(null);
    let result;
    try {
      result = await withActionTimeout(addContact(values));
    } catch (error) {
      if (error instanceof ActionTimeoutError) {
        const message =
          "The server didn't respond. Check the directory before trying again — the contact may have been added.";
        setError("root", { message });
        toast.error(message);
        return;
      }
      throw error;
    }
    if (!result.ok) {
      setError("root", { message: result.error });
      const existingUserId = result.existingUserId ?? null;
      setDuplicateUserId(existingUserId);
      toast.error(result.error, {
        // A duplicate address is the one failure with somewhere to go: the
        // contact that already holds it (decisions.md D-051).
        action: existingUserId
          ? {
              label: "Open contact",
              onClick: () => router.push(`/admin/directory/${existingUserId}`),
            }
          : undefined,
      });
      return;
    }
    toast.success(result.data.message);
    setOpen(false);
    reset(EMPTY);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset(EMPTY);
          setDuplicateUserId(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Add contact</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>
            Someone you want in the directory before they&apos;re on any event. If this address
            already has an account that isn&apos;t in the directory yet, it&apos;s linked instead
            of creating a second record — an address already in the directory can&apos;t be added
            twice.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input id="contact-name" placeholder="Ada Lovelace" {...register("name")} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              placeholder="ada@example.com"
              {...register("email")}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-title">Title (optional)</Label>
              <Input id="contact-title" placeholder="Principal Engineer" {...register("title")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-company">Company (optional)</Label>
              <Input
                id="contact-company"
                placeholder="Analytical Engines"
                {...register("company")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-bio">Bio (optional)</Label>
            <Textarea
              id="contact-bio"
              rows={4}
              placeholder="They can also write this themselves in the speaker portal."
              {...register("bio")}
            />
          </div>

          {errors.root && (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-destructive">{errors.root.message}</p>
              {duplicateUserId ? (
                <Link
                  href={`/admin/directory/${duplicateUserId}`}
                  className="text-sm text-foreground underline underline-offset-4"
                >
                  Open the existing contact
                </Link>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
