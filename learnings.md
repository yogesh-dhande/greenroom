# Learnings

Captured **post hoc** — non-trivial, hard-earned knowledge only: things that cost real effort to figure out (debugging discoveries, research dead-ends, surprising behavior that contradicted expectations). Not simple known facts, documented behavior, or anything obvious from code/docs — those don't belong here.

Format per entry: what we expected, what's actually true, and the evidence/source.

---

## Next.js 16 silently rewrites AGENTS.md on every dev/build (2026-08-08)

Expected: `next dev`/`next build` only touch `.next/` and build outputs. Actually: Next.js 16 auto-appends an "agent rules" block to the repo's `AGENTS.md` on every run (`node_modules/next/dist/server/lib/generate-agent-files.js`), silently modifying a hand-authored file outside `src/`. In this repo AGENTS.md is curated project memory, so this would have corrupted it on the first `npm run dev`. Caught via `git status` during scaffolding; disabled with `agentRules: false` in `next.config.ts`.
