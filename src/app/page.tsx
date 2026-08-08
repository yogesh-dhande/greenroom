import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Greenroom
          </span>
          <Link
            href="/login"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-24">
        <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-zinc-950 dark:text-zinc-50">
          Run your call for speakers, start to finish.
        </h1>
        <p className="mt-4 max-w-md text-lg leading-7 text-zinc-600 dark:text-zinc-400">
          Submission forms, review &amp; scoring, speaker onboarding, and the
          agenda builder — one open-source platform, no per-seat SaaS bill.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Sign in to your event
          </Link>
        </div>
      </main>

      <footer className="border-t border-zinc-200 px-6 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        Open source on GitHub.
      </footer>
    </div>
  );
}
