import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 inline-block text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          Greenroom
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Sign in
        </h1>
        <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Organizers, reviewers, and speakers all sign in with a magic link —
          no password.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}
