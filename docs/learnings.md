# Learnings

Captured **post hoc** — non-trivial, hard-earned knowledge only: things that cost real effort to figure out (debugging discoveries, research dead-ends, surprising behavior that contradicted expectations). Not simple known facts, documented behavior, or anything obvious from code/docs — those don't belong here.

Format per entry: what we expected, what's actually true, and the evidence/source.

---

## Next.js 16 silently rewrites AGENTS.md on every dev/build (2026-08-08)

Expected: `next dev`/`next build` only touch `.next/` and build outputs. Actually: Next.js 16 auto-appends an "agent rules" block to the repo's `AGENTS.md` on every run (`node_modules/next/dist/server/lib/generate-agent-files.js`), silently modifying a hand-authored file outside `src/`. In this repo AGENTS.md is curated project memory, so this would have corrupted it on the first `npm run dev`. Caught via `git status` during scaffolding; disabled with `agentRules: false` in `next.config.ts`.

## `allowJs: true` makes `tsc --noEmit` non-deterministic with generated worker output (2026-08-08)

Expected: `tsc --noEmit` is deterministic for a given source tree. Actually: with `allowJs: true`, tsconfig's include swept up the OpenNext-generated `.open-next/worker.js`, so typecheck results depended on whether a build had run — a `@ts-expect-error` in `custom-worker.ts` was required after a build and flagged as unused before one. No setting of the suppression could satisfy both states. Fixed by setting `allowJs: false` so only authored TS is checked.

## better-auth returns 403 on POSTs missing an `Origin` header (2026-08-08)

Expected: a failing magic-link request points to a config/session bug. Actually: better-auth's CSRF protection rejects any state-changing POST without an `Origin` header matching `trustedOrigins` — so curl-based testing (which sends no Origin by default) gets 403s that look like broken auth while the browser flow works fine. Test with `-H "Origin: http://localhost:3000"`.

## shadcn CLI (Tailwind v4) silently rewrites files and can break fonts (2026-08-08)

Expected: `shadcn init`/`add` only create the components you asked for. Actually, three surprises: the v4 CLI dropped `--base-color` and requires a style via `-p` (e.g. `-p nova`); `init` silently overwrites an existing `src/lib/utils.ts`; and the generated globals.css declares `--font-sans: var(--font-sans)` — self-referential, so if `next/font` injects a differently-named variable, the font silently falls back to system UI with no error. Diff `git status` after every CLI run and wire the `next/font` variable name into the theme block explicitly.

## `getPlatformProxy` resolves wrangler config relative to the calling file, not cwd (2026-08-08)

Expected: running a script with `getPlatformProxy()` from the project root "just works". Actually: it resolves `wrangler.jsonc` and node_modules from the location of the *file* that calls it, not the working directory — the seed script only found the D1 binding once it lived inside the project root tree (`scripts/seed.ts`), not when invoked via an outside path. Same root cause bit again during the comms wave: a throwaway probe script in a scratch directory failed with `ERR_MODULE_NOT_FOUND: 'ics'` because Node resolves `node_modules` from the script file's location too. Rule: any script touching project deps or wrangler config must live inside the project tree.

## `ics` npm package has no TZID/VTIMEZONE support at all (2026-08-08)

Expected: pass a timezone to `ics@3.12`, get `DTSTART;TZID=…` plus a VTIMEZONE block. Actually: the library only emits floating local or UTC times — grepping its dist and `index.d.ts` shows no VTIMEZONE emitter whatsoever. Worse, hand-adding a bare `TZID` without VTIMEZONE violates RFC 5545 §3.2.19, and Microsoft documents Outlook then falling back to the *recipient's* timezone (MS-STANOICAL V0032) — invites silently rendering at wrong times. Consequence: `src/lib/ics.ts` emits UTC instants derived from the event's IANA zone and repeats the local wall clock in DESCRIPTION/body copy (decisions.md D-020).

## Naive standalone-tag stripping welds template paragraphs together (2026-08-08)

Expected: when a `{{#field}}`/`{{/field}}` pair sits on its own lines, dropping just the tags preserves layout. Actually: each dropped tag consumes one newline, so two paragraphs merged into a single run-on block in the rendered email — invisible in a code diff, obvious to a recipient. Fix: consume the whole standalone *block* line including its trailing newline (Mustache's own standalone-line semantics); a regression test now asserts no built-in template renders `[a-z].\n[A-Z]`.

## dnd-kit: three behaviors that cost real debugging (2026-08-08)

1. **A disabled draggable still poisons its element.** Expected: `useDraggable({ disabled: true })` just prevents drags. Actual: spreading its `attributes` still applies `aria-disabled="true"`, so a read-only card announced itself as a disabled button and Playwright refused to click it (`element is not enabled`, 60s timeout). Fix: only spread `attributes`/`listeners` when dragging is allowed.
2. **Hydration-unstable ids without an explicit `<DndContext id>`.** The default `aria-describedby` ids come from a module-level counter that differs between server and client render → React attribute-mismatch warning on every page load. A constant `id` prop removes it.
3. **Auto-scroll relocates drop targets mid-drag in tests.** A programmatic drag aimed at a 10:00 slot landed at 16:00 in another room: the pointer nearing the viewport edge auto-scrolled the board after coordinates were measured. Fix for deterministic drag tests: size the viewport so the grid fits with no scroll container.

## Miniflare's D1 binding wedges if the sqlite file is reseeded under a running dev server (2026-08-08)

Expected: reseeding local D1 (`npm run seed`) is safe anytime; the next request just sees new data. Actual: a dev server that was already running starts failing every write with `internal error` (e.g. `insert into "auth_verifications"…`) while the identical statement succeeds via `wrangler d1 execute --local`. Only restarting the dev server clears it. Direct consequence for parallel agents sharing one local DB: never reseed while someone else's dev server is up.

## zod 4: `z.unknown()` fields are required, unlike zod 3 (2026-08-08)

Expected (zod 3 behavior): `z.unknown()` in an object schema is implicitly optional — a missing key parses fine. Actually in zod 4 `unknown` keys are **required**: a missing key fails parsing, and worse, in a generated form validator the failure surfaced as a confusing type-level error instead of the intended per-field "required" message. Zod 4 changed this deliberately (only `.optional()` marks a key optional). Any dynamically generated schema whose leaf type is `unknown` needs an explicit `.optional()` plus its own required-check where "required" is a runtime flag.

## R2's `writeHttpMetadata(headers)` throws `DevalueError` under `next dev` (2026-08-08)

Expected: the documented `object.writeHttpMetadata(headers)` idiom populates response headers from R2 metadata anywhere the binding works. Actually under `next dev` (getPlatformProxy), R2 objects cross a serialization boundary and the method throws `DevalueError: Cannot stringify arbitrary non-POJOs` — while the same code is fine in a deployed Worker. Reading `object.httpMetadata` field-by-field (`contentType`, etc.) works in both environments; the proxy serializes plain fields, just not the header-writing method's machinery.

## Playwright SIGKILLs its webServer tree — in-process cleanup handlers never run (2026-08-08)

Expected: a webServer wrapper script can restore swapped config (`.dev.vars`) in `SIGTERM`/`exit` handlers when the run ends. Actually those handlers reliably did NOT fire — two separate agents found `.dev.vars` still pointing at the e2e port after green runs. Playwright kills the webServer's process tree with SIGKILL, which is uncatchable, so no in-process cleanup in the server wrapper can ever be trusted. Fix: do cleanup in Playwright's own `globalTeardown` (runs in the Playwright process, which exits normally), keeping the wrapper's restore-from-stale-backup self-heal as a second net.

## A `"use client"` import chain can pull the email transport into the browser bundle (2026-08-08)

Expected: importing a constant (a filter list, decision options) from a domain module into a client component is free. Actually: the import makes the whole module — and everything it transitively imports — part of the client bundle, so a client component reaching anything that touches `src/domain/comms.ts` dragged the email-transport code toward the browser. Cost a refactor mid-wave: shared constants moved into small UI-side modules (`filters.ts`), and client components spell out option lists locally instead of importing them from server-leaning domain files. Rule of thumb: domain modules that touch transports/repos are server-only; anything a client component needs from them gets its own dependency-free module. (`import type` is the exception — it's erased at compile time, so type-only imports from server-leaning modules are safe; only *value* imports drag the graph in. Confirmed while building the comms hub, which imports types from `@/domain/comms` but values only from `@/domain/comms-templates`.)

## Playwright: `alertdialog` role and worker-discard turning one failure into many (2026-08-08)

Two behaviors that cost a red run: (1) shadcn/Radix `AlertDialog` exposes ARIA role **`alertdialog`** — `getByRole("dialog")` never matches it, and the timeout looks like a missing dialog rather than a wrong query. (2) Playwright discards the worker process after a test failure, so module-level state shared between tests (ids captured in an earlier test) evaporates and one real failure cascades into every later test failing for the wrong reason. Tests must each re-derive their target through the UI rather than sharing module state.

## Deterministic-looking seed logic can be nondeterministic via unordered SQL reads (2026-08-08)

Expected: a seed script that assigns task states by a fixed formula over speaker positions produces identical data every run. Actually: the positions came from iterating a Set built on `listSpeakerIds()`, whose D1 implementation has no `ORDER BY` — so sqlite's row order silently varied across reseeds and the "same" formula produced different per-speaker completed/pending states, surfacing as an intermittent e2e failure that looked like a test bug. Fix: sort by a fixed application-side key (the speaker's index in the seed fixture) before enumerating; never let unordered query results feed order-dependent logic, even in "just a seed script."

## Next.js: `not-found.tsx` beside a layout doesn't catch that layout's own `notFound()` (2026-08-08)

Expected: putting `not-found.tsx` next to `[eventSlug]/layout.tsx` renders it when the layout calls `notFound()` for an unknown slug. Actually: a segment's not-found boundary only wraps the layout's *children* — a `notFound()` thrown by the layout itself escapes to the parent segment and rendered the app's root 404 instead. The public/embed 404 pages had to move one directory up (`src/app/p/not-found.tsx`, `src/app/embed/not-found.tsx`) to sit in the parent segment of the layout that throws.

## React `<img onError>` misses errors that fire before hydration (2026-08-08)

Expected: `onError` on an `<img>` reliably triggers the initials fallback for a dead headshot URL. Actually: on a server-rendered page the browser can fetch and fail the image before React hydrates and attaches the handler, so the native `error` event fires into the void and the broken-image icon sticks (confirmed via screenshot: four broken icons, zero fallbacks). Fix in `speaker-headshot.tsx`: a callback ref that checks `img.complete && img.naturalWidth === 0` the moment React attaches, catching failures that pre-date hydration.

## A logging email sender that stamps wall-clock `sentAt` breaks simulated-time tests (2026-08-08)

Expected: running the reminder job twice under a simulated `ctx.now` (e.g. 2026-05-01) exercises the cooldown against the first run's log rows. Actually: `createLoggingEmailSender` stamps `sentAt: new Date()` — real wall-clock — so the first run's rows sat three months in the *future* relative to the simulated clock and the cooldown never expired, which looked like a cadence bug. Tests must seed `email_log` rows with explicit timestamps rather than relying on two live runs; threading `ctx.now` into the log write is the at-source fix if anything else ever runs on simulated time.

## Playwright `getByText` matches a `<textarea>`'s value (2026-08-08)

Expected: asserting `getByText("{{badField}}")` finds the error message that echoes the offending merge field. Actually: Playwright's text matching also sees the textarea's *value*, so the same string matched both the input and the error — a guaranteed strict-mode violation that reads like a duplicated element. Assert through the error item's own locator (role/testid), never bare text that's also present in an input.

## Resend attachments: `contentType` camelCase, base64 string content, no raw MIME (2026-08-08)

Expected: set an attachment's MIME type via a `Content-Type` entry in Resend's `headers`. Actually: that returns a 500 "Duplicate header"; the only channel is the attachment's own `contentType` (camelCase) field, with `content` as a base64 *string*. Resend also has no raw-MIME endpoint, so the classic Gmail-friendly `multipart/alternative` with a `text/calendar` sibling part is unreachable — calendar invites must ship as a `text/calendar; method=REQUEST` attachment (D-020).

## The agenda board auto-scrolls under a dnd-kit drag at small viewports (2026-08-08)

Expected: replicating `e2e/agenda.spec.ts`'s drag (move past the 5px activation threshold, then to the pre-computed drop coordinate) would land a card on the intended slot in the 1280×720 demo recording. Actually: the board's horizontal auto-scroll kicks in while the pointer crosses it, sliding the columns out from under a coordinate computed before the drag — the card silently landed one column over (Workshop A instead of Main Stage), producing no conflict. `agenda.spec.ts` never sees this because it sets a 1600×1500 viewport where nothing scrolls. Fix in `e2e/demo-walkthrough.record.ts`: after the initial travel, re-read the target slot's bounding box and re-aim until the slot itself highlights, then drop.

## Deploying OpenNext to a fresh Cloudflare account hits three separate walls (2026-08-09)

Expected: `npm run deploy` (OpenNext build + deploy) pushes the worker; failing that, a plain `wrangler deploy` bypasses OpenNext's broken cache pre-warm. Actually, three independent problems stacked:

1. **`wrangler deploy` cannot be used to bypass OpenNext** — wrangler ≥4.120 prints "OpenNext project detected, calling `opennextjs-cloudflare deploy`" and silently delegates, so every invocation from the project directory re-enters the broken populate-cache path. Bypass: run `node <project>/node_modules/wrangler/wrangler-dist/cli.js deploy --config <project>/wrangler.jsonc` **from outside the project directory** (detection is cwd-based).
2. **The populate-cache "R2 worker timeout" retry loop was a missing workers.dev subdomain.** OpenNext's remote-cache writer is an edge-preview session, which Cloudflare refuses with error 10063 when the account has never registered a workers.dev subdomain; the CLI surfaces that as endless "Failed to send request to R2 worker: The operation was aborted due to timeout" retries, while direct `wrangler r2 object put --remote` works — which falsely exonerates R2. No wrangler command registers a subdomain; `PUT /accounts/{id}/workers/subdomain` with the account's OAuth token does. Even after that fix the proxy returned plain 500s, so the pre-warm was abandoned entirely — the 5 cache entries are lazy-filled ISR pages and cost one slow render each.
3. **The free Workers plan rejects bundles over 3 MiB gzipped** (code 10027) — ours was 3457 KiB. `--minify` brought it to 3057 KiB, 15 KiB under the cap; now pinned as `"minify": true` in wrangler.jsonc. Watch this number: any dependency growth breaks deploys until the $5/mo paid plan (10 MiB).

Bonus, from seeding remote D1: `wrangler d1 execute --remote --file` runs the file in **batches, and `PRAGMA defer_foreign_keys` does not span them** — a schema-ordered dump fails with FOREIGN KEY constraint errors even though the same file passes locally in one transaction. Dump data in FK dependency order instead (and DELETEs in reverse, child-first, for the same reason); note `sqlite3 .dump --data-only t1 t2 …` ignores argument order (it walks sqlite_master), so it takes one `.dump` call per table.

## A stray bare `~/.wrangler` directory silently hijacks wrangler's auth config (2026-08-09)

Expected: with a valid OAuth token in `~/Library/Preferences/.wrangler/config/default.toml`, `wrangler whoami` stays logged in. Actually: wrangler treats an existing `~/.wrangler` as the *legacy* global config dir and prefers it wholesale — and other tooling can create that directory as a side effect (here: a skills-repo cache plus metrics/log files written mid-session). Once the bare directory existed, every wrangler command reported "Not logged in / no credentials were found" while the real token sat untouched in Library/Preferences. Diagnosed by noticing the log path in errors had flipped from `Library/Preferences/.wrangler/logs` to `~/.wrangler/logs`. Fix: move `~/.wrangler` aside (nothing in it was wrangler's) — auth returns instantly. That fix did not hold: wrangler itself recreates the bare directory within seconds during startup (skills cache, metrics, logs), so auth broke again on the next deploy. Durable fix: `mkdir -p ~/.wrangler/config && ln -sf ~/Library/Preferences/.wrangler/config/default.toml ~/.wrangler/config/default.toml` — whichever config dir wrangler prefers now resolves to the same token file, and the symlink survives the directory being repopulated.

## An eval agent clicking "Sign out" revokes the shared saved session server-side (2026-08-09)

Expected: the sbek harness's per-persona `.auth/*.json` storage states make scenarios independent — a scenario ending in a logged-out browser can't affect the next one, since each fresh context re-loads the saved cookies. Actually: better-auth's sign-out is a server-side revocation, not a client-side cookie wipe — when the CFP-S3 agent followed its script's "sign out and sign in as the reviewer" step (transcript turn 41, "Let me sign out now."), the organizer session *token in the saved file* became invalid on the server, and every later organizer scenario in the run started logged out (same for ABS-S3 killing the reviewer). The visible symptom was misleading twice over: it looked like session expiry (it wasn't — better-auth default lifetime is ~7 days), and the owner's inbox filled with magic-link emails (logged-out agents filling the login form with persona emails). Fix in the harness: sign-out endpoints are blocked at the Playwright route layer, and mid-scenario identity changes go through a `switch_persona` tool that swaps cookies from another persona's saved state without touching the server. After any run where sign-out happened, affected personas need `npm run sbek -- auth --persona <name>` re-auth.

## workerd rejects the global `fetch` when called through a stored reference (2026-08-09)

Expected: `class C { constructor(f = fetch) { this.f = f } }` works in Cloudflare Workers like it does in vitest/Node — the W10 Airtable sync passed all unit tests, then every request of the first live cron run failed with "Illegal invocation: function called with incorrect `this` reference". workerd enforces that `fetch` be invoked with the global as `this`; calling it as `this.fetchImpl(...)` binds the class instance instead. Node does not care, so tests can't catch it without running in workerd. Fix: default injectable transports to a wrapper closure — `(input, init) => fetch(input, init)` — never the bare global.
