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

## Resend attachments: `contentType` camelCase, base64 string content, no raw MIME (2026-08-08)

Expected: set an attachment's MIME type via a `Content-Type` entry in Resend's `headers`. Actually: that returns a 500 "Duplicate header"; the only channel is the attachment's own `contentType` (camelCase) field, with `content` as a base64 *string*. Resend also has no raw-MIME endpoint, so the classic Gmail-friendly `multipart/alternative` with a `text/calendar` sibling part is unreachable — calendar invites must ship as a `text/calendar; method=REQUEST` attachment (D-020).
