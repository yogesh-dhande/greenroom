import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, homePathForRole } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // Already signed in: the form would just re-send a link to the same
  // account. Send them where signing in would have taken them.
  const user = await getSessionUser();
  if (user) redirect(homePathForRole(user.role));

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 inline-block text-sm font-semibold tracking-tight text-foreground"
        >
          Greenroom
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Sign in
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Admins, reviewers, and speakers all sign in with a magic link — no
          password.
        </p>
        {/* useSearchParams (for the post-login `next` redirect) requires a
         * Suspense boundary so the rest of the page can render statically. */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
