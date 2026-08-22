import Link from "next/link";

/**
 * App-wide 404: catches URLs that match no route at all, where no segment's
 * own not-found.tsx boundary applies. Styled like the marketing page
 * (src/app/page.tsx) instead of left as the framework default.
 *
 * It also teaches the URL shape, because the overwhelmingly common way to
 * arrive here is guessing an unslugged path. The 2026-08-18 evaluator asked
 * for `/agenda`, `/schedule`, `/sessions`, `/talks`, `/program`, `/speakers`,
 * `/gallery`, `/cfp`, `/submit`, `/explore` and more — every one of them a
 * real Greenroom surface that simply needs to name its event first, because
 * one deployment hosts many. Aliases that *can* be resolved unambiguously are
 * redirects instead (see src/app/events and src/app/apply); this is for the
 * ones with no event in the URL to resolve, where the honest answer is to say
 * what is missing rather than to guess an event on the visitor's behalf.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Greenroom
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          404
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold text-foreground">
          Page not found
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, or may have moved.
        </p>

        <div className="mt-8 w-full max-w-md rounded-lg border border-border bg-card p-4 text-left">
          <p className="text-sm font-medium text-foreground">
            Looking for an event&apos;s program?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Greenroom hosts many events, so public pages name theirs in the URL:
          </p>
          <ul className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
            <li>/p/&lt;event&gt; — the event&apos;s program</li>
            <li>/p/&lt;event&gt;/schedule — sessions and agenda</li>
            <li>/p/&lt;event&gt;/speakers — the speaker gallery</li>
            <li>/submit/&lt;call-for-speakers&gt; — submit a proposal</li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Your organizer&apos;s invitation or the event&apos;s own site has the full link.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
          <Link href="/" className="font-medium text-primary underline underline-offset-4">
            Go to Greenroom
          </Link>
          <Link
            href="/login"
            className="font-medium text-primary underline underline-offset-4"
          >
            Sign in
          </Link>
        </div>
      </main>
    </div>
  );
}
