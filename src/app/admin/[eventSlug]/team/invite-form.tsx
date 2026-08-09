"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { inviteTeammate } from "./actions";

const formSchema = z.object({
  name: z.string().trim().max(120, "Keep this under 120 characters").optional(),
  email: z.email("Enter a valid email address"),
  role: z.enum(["admin", "reviewer"]),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * Add someone by address, whether or not they have an account yet.
 *
 * The name is optional — someone can always set or fix it themselves once
 * they sign in — but giving it up front means the roster and reviewer pools
 * show a person, not an email address, from the moment they're added
 * (D-044(3), D-062).
 */
export function InviteForm({ eventSlug }: { eventSlug: string }) {
  const [added, setAdded] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", role: "reviewer" },
  });

  async function onSubmit(values: FormValues) {
    // Spelled out rather than passed through: the server action's schema
    // applies a `.transform()` to `name`, which makes the key required in
    // its inferred input type even though the value stays optional — a bare
    // `FormValues` (name?: string) doesn't structurally match that.
    const result = await inviteTeammate(eventSlug, { ...values, name: values.name });
    if (!result.ok) {
      setError("root", { message: result.error });
      toast.error(result.error);
      return;
    }
    toast.success(result.data.message);
    setAdded(result.data.email);
    reset({ name: "", email: "", role: values.role });
  }

  async function copySignInLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login`);
      toast.success("Sign-in link copied");
    } catch {
      toast.error("Couldn't copy — the sign-in page is at /login");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-name">Name (optional)</Label>
          <Input
            id="invite-name"
            autoComplete="off"
            placeholder="Ada Lovelace"
            {...register("name")}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            placeholder="reviewer@example.com"
            {...register("email")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="invite-role" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : "Add to team"}
        </Button>
      </div>

      {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

      <p className="text-sm text-muted-foreground">
        Greenroom emails them an invitation with the sign-in link — there&apos;s no password, just
        a magic link to this address. If they already have an account, this just changes their
        role.
      </p>

      {added && (
        <p className="text-sm text-foreground">
          <span className="font-medium">{added}</span> is on the team and has been emailed the
          sign-in link.
        </p>
      )}

      <div>
        <Button type="button" variant="outline" size="sm" onClick={copySignInLink}>
          Copy sign-in link
        </Button>
      </div>
    </form>
  );
}
