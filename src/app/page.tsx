import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getSessionUser, homePathForRole } from "@/lib/session";

const REPO_URL = "https://github.com/yogesh-dhande/greenroom";

const INTEGRATION_HIGHLIGHTS = [
  {
    eyebrow: "AUTOMATION",
    title: "Airtable sync, already built in",
    body: "Greenroom creates the tables and pushes event data on schedule or on demand, so your existing Airtable automations keep working.",
  },
  {
    eyebrow: "EXTENSIBILITY",
    title: "REST API + remote MCP",
    body: "Connect software or AI tools with event-scoped API keys or OAuth. Both surfaces use the same guarded workflows as the organizer UI.",
  },
  {
    eyebrow: "SPEAKER CRM",
    title: "Relationships across events",
    body: "Keep one searchable directory with tags, saved segments, event history, bulk email, and a sourcing pipeline.",
  },
];

const FEATURES = [
  {
    title: "CFP to published program",
    body: "Build forms, collect drafts, review, decide, onboard, schedule, and publish without re-entering a record.",
  },
  {
    title: "Structured review rounds",
    body: "Track-scoped queues, explicit assignments, and weighted scorecards round by round.",
  },
  {
    title: "Speaker portal",
    body: "Magic-link access to profiles, checklists, forms, uploads, and session status.",
  },
  {
    title: "Real email + calendar",
    body: "Send templated email, keep a delivery log, and issue calendar invites that update in place.",
  },
  {
    title: "Conflict-aware agenda",
    body: "Drag sessions across rooms and times with blocking and advisory conflicts called out immediately.",
  },
  {
    title: "Widgets and open feeds",
    body: "Publish five configurable widget types through script, iframe, JSON, XML, and iCal outputs.",
  },
];

type MockSession = {
  title: string;
  meta: string;
  warn?: boolean;
  conflict?: string;
};

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
    ? {
        href: homePathForRole(user.role),
        label: user.role === "speaker" ? "Go to your portal" : "Go to admin",
      }
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
          <Link
            href="#demo"
            className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
          >
            Demo
          </Link>
          <Link
            href="#features"
            className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
          >
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
            <h1 className="max-w-xl text-4xl leading-[1.07] font-bold tracking-tight text-balance text-foreground sm:text-5xl">
              Speaker management you actually own.
            </h1>
            <p className="mt-4 max-w-md text-lg leading-7 text-muted-foreground">
              One fast workflow to collect proposals, review sessions, onboard
              speakers, build the agenda, and publish the program.
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
                $ <span className="text-primary">npm run deploy</span> — and
                it&rsquo;s yours
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
                      <span className="block text-[0.8rem] font-semibold text-foreground">
                        {s.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.meta}
                      </span>
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

        <section
          id="demo"
          className="mx-auto w-full max-w-6xl scroll-mt-8 px-6 pb-20"
        >
          <div className="mb-7 max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              See the whole workflow in one demo.
            </h2>
            <p className="mt-2 text-muted-foreground">
              One continuous demo on seeded data: build a CFP form, take a
              public submission through blind review to acceptance, finish
              onboarding in the speaker portal, place the talk on a
              conflict-aware agenda, and publish the program. Spoken narration
              and English captions are included.
            </p>
          </div>
          <video
            controls
            playsInline
            preload="metadata"
            poster="/demo-poster.jpg"
            className="aspect-video w-full rounded-xl border border-border bg-card shadow-[0_16px_44px_-12px_var(--tw-shadow-color)] shadow-foreground/15"
          >
            <track
              kind="captions"
              src="/demo.vtt"
              srcLang="en"
              label="English"
              default
            />
            <source src="/demo.mp4" type="video/mp4" />
            Your browser does not support embedded video.{" "}
            <a href="/demo.mp4" className="underline underline-offset-2">
              Download the walkthrough
            </a>
            .
          </video>
        </section>

        <section
          id="features"
          className="mx-auto w-full max-w-6xl scroll-mt-8 px-6 pb-20"
        >
          <div className="mb-7 max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              From open CFP to showtime.
            </h2>
            <p className="mt-2 text-muted-foreground">
              Greenroom keeps the essential speaker workflow connected, so
              producers never have to rebuild the same event in five tools.
            </p>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-border bg-card px-5 py-4"
              >
                <h3 className="flex items-center gap-2.5 text-[0.96rem] font-semibold text-foreground">
                  <span
                    aria-hidden
                    className="size-2 rounded-full bg-primary"
                  />
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-3">
            {INTEGRATION_HIGHLIGHTS.map((highlight, index) => (
              <div
                key={highlight.title}
                className={`px-5 py-5 sm:px-6 ${index > 0 ? "border-t border-border lg:border-t-0 lg:border-l" : ""}`}
              >
                <p className="font-mono text-[0.68rem] font-semibold tracking-[0.14em] text-primary">
                  {highlight.eyebrow}
                </p>
                <h3 className="mt-2 text-base font-semibold text-foreground">
                  {highlight.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {highlight.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        Open source on{" "}
        <a
          href={REPO_URL}
          className="underline underline-offset-2 hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        . Self-host on Cloudflare — your data stays yours.
      </footer>
    </div>
  );
}
