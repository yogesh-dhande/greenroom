import Link from "next/link";

/**
 * App-wide 404: catches URLs that match no route at all, where no segment's
 * own not-found.tsx boundary applies. Styled like the marketing page
 * (src/app/page.tsx) instead of left as the framework default.
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
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, or may have moved.
        </p>
        <Link
          href="/"
          className="mt-6 text-sm font-medium text-primary underline underline-offset-4"
        >
          Go to Greenroom
        </Link>
      </main>
    </div>
  );
}
