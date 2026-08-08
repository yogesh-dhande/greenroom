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

Expected: running a script with `getPlatformProxy()` from the project root "just works". Actually: it resolves `wrangler.jsonc` and node_modules from the location of the *file* that calls it, not the working directory — the seed script only found the D1 binding once it lived inside the project root tree (`scripts/seed.ts`), not when invoked via an outside path.
