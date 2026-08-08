"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const magicLinkRequestSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});
type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

/** Magic-link request form (decisions.md D-007: every role signs in this
 * way — no passwords). react-hook-form handles field state, Zod validates. */
export function LoginForm() {
  const [sent, setSent] = useState<string | null>(null);
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
      callbackURL: "/dashboard",
    });
    if (error) {
      setError("root", { message: error.message ?? "Something went wrong" });
      return;
    }
    setSent(values.email);
  }

  if (sent) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Check <span className="font-medium text-zinc-950 dark:text-zinc-50">{sent}</span> for
        a sign-in link. It expires in 5 minutes.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
        )}
      </div>
      {errors.root && (
        <p className="text-sm text-red-600 dark:text-red-400">{errors.root.message}</p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {isSubmitting ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
