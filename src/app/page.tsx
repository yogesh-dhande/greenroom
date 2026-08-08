import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Greenroom
          </span>
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-24">
        <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-foreground">
          Run your call for speakers, start to finish.
        </h1>
        <p className="mt-4 max-w-md text-lg leading-7 text-muted-foreground">
          Submission forms, review &amp; scoring, speaker onboarding, and the
          agenda builder — one open-source platform, no per-seat SaaS bill.
        </p>
        <div className="mt-8">
          <Button asChild>
            <Link href="/login">Sign in to your event</Link>
          </Button>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Open source on GitHub.
      </footer>
    </div>
  );
}
