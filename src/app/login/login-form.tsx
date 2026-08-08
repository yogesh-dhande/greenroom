"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const magicLinkRequestSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});
type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** Magic-link request form (decisions.md D-007: every role signs in this
 * way — no passwords). react-hook-form handles field state, Zod validates. */
export function LoginForm() {
  const [sent, setSent] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<MagicLinkRequest>({
    resolver: zodResolver(magicLinkRequestSchema),
  });

  async function onSubmit(values: MagicLinkRequest) {
    const { error } = await authClient.signIn.magicLink({
      email: values.email,
      callbackURL: next ?? "/dashboard",
    });
    if (error) {
      setError("root", { message: error.message ?? "Something went wrong" });
      return;
    }
    setSent(values.email);
  }

  if (sent) {
    return (
      <p className="text-sm text-muted-foreground">
        Check <span className="font-medium text-foreground">{sent}</span> for
        a sign-in link. It expires in 5 minutes.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>
      {errors.root && (
        <p className="text-sm text-destructive">{errors.root.message}</p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send magic link"}
      </Button>
    </form>
  );
}
