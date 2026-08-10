import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSessionUser, homePathForRole } from "@/lib/session";

const REPO_URL = "https://github.com/yogesh-dhande/greenroom";

const FEATURES = [
  { title: "Call for papers", body: "Public submission forms with your questions, tracks, and deadlines." },
  { title: "Review rounds", body: "Track-scoped reviewers with structured scoring, round by round." },
  { title: "Speaker portal", body: "Checklists, uploads, and magic-link sign-in for every speaker." },
  { title: "Communications", body: "Templated email to the right speakers, with a full send log." },
  { title: "Agenda builder", body: "Rooms, times, and automatic conflict flags before attendees notice." },
  { title: "Public program", body: "Published schedule with a calendar feed and embeddable widgets." },
];

type MockSession = { title: string; meta: string; warn?: boolean; conflict?: string };

const AGENDA_MOCK: { day: string; sessions: MockSession[] }[] = [
  {
    day: "TUE · MAIN STAGE",
    sessions: [
      { title: "Opening keynote", meta: "09:30 · Aisha Nwosu" },
      { title: "Evals in production", meta: "11:00 · Dana Okoye" },
      {
        title: "Agents on stage",
        meta: "14:00 · Dana Okoye",
        warn: true,
        conflict: "Speaker overlap — Track B, 14:00",
      },
    ],
  },
  {
    day: "TUE · TRACK B",
    sessions: [
      { title: "Tool-use patterns", meta: "11:00 · Marco Silva" },
      { title: "Eval pipelines live", meta: "14:00 · Dana Okoye", warn: true },
      { title: "Closing panel", meta: "16:30 · All tracks" },
    ],
  },
];

/**
 * A signed-in visitor who lands back here (bookmark, logo click) needs a way
 * back into the app — "Sign in" is a dead end that just shows them the form
 * again. `getSessionUser` is a single cheap cookie+session read (no event
 * queries), so the marketing page reads it directly rather than staying
 * static; there's no PPR config here to stream around it.
 */
export default async function Home() {
  const user = await getSessionUser();
  const home = user
    ? { href: homePathForRole(user.role), label: user.role === "speaker" ? "Go to your portal" : "Go to admin" }
    : null;
  const cta = home ?? { href: "/login", label: "Start your event" };

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b border-border">
        <nav className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-4">
          <span className="mr-auto flex items-center gap-2.5 text-base font-bold tracking-tight text-foreground">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-primary" />
            Greenroom
          </span>
          <Link href="#features" className="hidden text-sm text-muted-foreground hover:text-foreground sm:block">
            Features
          </Link>
          <a
            href={REPO_URL}
            className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            target="_blank"
            rel="noreferrer"
          >
            Open source
          </a>
          <Button asChild size="sm">
            <Link href={cta.href}>{home ? home.label : "Sign in"}</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-12 gap-y-12 px-6 pt-16 pb-14">
          <div className="min-w-[300px] flex-[1_1_360px]">
            <span className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
              Open-source Sessionboard alternative
            </span>
            <h1 className="mt-5 max-w-xl text-4xl leading-[1.07] font-bold tracking-tight text-balance text-foreground sm:text-5xl">
              Speaker management you actually own.
            </h1>
            <p className="mt-4 max-w-md text-lg leading-7 text-muted-foreground">
              Call for papers, review rounds, a speaker portal, communications, and a public program
              with embeddable widgets — deployed to your own Cloudflare account in minutes.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
              <Button asChild variant="outline">
                <a href={REPO_URL} target="_blank" rel="noreferrer">
                  View on GitHub
                </a>
              </Button>
              <code className="rounded-lg border border-border bg-card px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                $ <span className="text-primary">wrangler deploy</span> — and it&rsquo;s yours
              </code>
            </div>
          </div>

          {/* Decorative agenda-builder vignette; the data is illustrative. */}
          <div
            aria-hidden
            className="min-w-[320px] max-w-[560px] flex-[1_1_400px] overflow-hidden rounded-xl border border-border bg-card shadow-[0_16px_44px_-12px_var(--tw-shadow-color)] shadow-foreground/15"
          >
            <div className="flex items-center gap-1 border-b border-border px-2 py-2.5 text-xs text-muted-foreground sm:gap-2 sm:px-4 sm:text-sm">
              {["Submissions", "Review", "Agenda", "Speakers"].map((tab) => (
                <span
                  key={tab}
                  className={
                    tab === "Agenda"
                      ? "rounded-md bg-accent px-2 py-1 font-semibold text-accent-foreground sm:px-2.5"
                      : "px-2 py-1 sm:px-2.5"
                  }
                >
                  {tab}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 p-4">
              {AGENDA_MOCK.map((col) => (
                <div key={col.day} className="min-w-0">
                  <h4 className="mb-2 font-mono text-[0.66rem] font-medium tracking-[0.14em] text-muted-foreground">
                    {col.day}
                  </h4>
                  {col.sessions.map((s) => (
                    <div
                      key={s.title}
                      className={`mb-2 rounded-md border border-border bg-background py-2 pr-2.5 pl-2.5 border-l-[3px] ${
                        s.warn ? "border-l-warning" : "border-l-primary"
                      }`}
                    >
                      <span className="block text-[0.8rem] font-semibold text-foreground">{s.title}</span>
                      <span className="text-xs text-muted-foreground">{s.meta}</span>
                      {s.conflict ? (
                        <span className="mt-1.5 inline-block rounded-full bg-warning/15 px-2 py-0.5 text-[0.68rem] font-semibold text-warning">
                          ⚠ {s.conflict}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto w-full max-w-6xl px-6 pb-20">
          <h2 className="sr-only">Features</h2>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg border border-border bg-card px-5 py-4">
                <h3 className="flex items-center gap-2.5 text-[0.96rem] font-semibold text-foreground">
                  <span aria-hidden className="size-2 rounded-full bg-primary" />
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Open source on{" "}
        <a href={REPO_URL} className="underline underline-offset-2 hover:text-foreground" target="_blank" rel="noreferrer">
          GitHub
        </a>
        . Self-host on Cloudflare — your data stays yours.
      </footer>
    </div>
  );
}
