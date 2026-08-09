# Agent Instructions — Greenroom

**Greenroom** — an open-source Sessionboard alternative for the AIE "Kill My SaaS" competition (deadline: Wed Aug 12, 2026, 10 PM PT). Read these three documents before non-trivial work; keep them current as you go — they are the project's memory.

## Project documents

- **[spec.md](spec.md)** — product requirements, the source of truth for *what* we build. Capture all product requirements here and keep them up to date: when scope changes, a requirement is clarified, or a feature is cut/added, update spec.md in the same session — don't let it drift from reality. Keep it concise; no UI/implementation details. Mark optional sections clearly.
- **[decisions.md](decisions.md)** — key decisions with rationale (*why* we build it this way). When a significant technical or product decision is made, add an entry with the decision, rationale, and status (pending/accepted/superseded). Every entry is a **first-class decision** — never append "addendum"/"revision"/"clarification" sections to existing entries. If an organizer clarification or owner change alters scope, that's a *new* decision (or a rewrite of the entry to state the current decision) with the clarification cited in the rationale. Check pending decisions before building on an assumption; don't silently resolve a pending decision — surface it to the owner.
- **[learnings.md](learnings.md)** — captured **post hoc**, and only for non-trivial hard-earned knowledge: debugging discoveries, research dead-ends, surprising behavior that cost real effort and contradicted expectations (record expected vs. actual, with evidence). Do NOT log simple known facts, documented behavior, or routine findings. Check it before debugging anything that feels familiar.
- **[questions.md](questions.md)** — open questions we should get clarification on (owner or organizer), each with why it matters and the working assumption we build with meanwhile. Add an entry instead of silently resolving an uncertainty; when a question is answered, record it as a first-class decision in decisions.md and delete it here.
- **[todo.md](todo.md)** — the owner's action list: everything that only the owner can do (credentials, dashboard toggles, external accounts, submission steps). Keep it current in the same session as the state change — add items the moment they become needed, move them to Done the moment they complete (owner directive 2026-08-09).

## Subagent usage

- Delegate coding and implementation tasks to subagents running an appropriately lower-power model — allowed models are Fable, Opus, and Sonnet only (no Haiku): Sonnet for routine implementation and mechanical edits, Opus for harder pieces, Fable reserved for the main thread and the most complex work. Give each subagent a well-scoped task with the relevant context (spec section, decision IDs, files to touch) rather than the whole conversation.
- Keep the main thread for orchestration, key decisions, and integration: breaking work down, sequencing subagents, resolving anything ambiguous or decision-shaped (log those to decisions.md), and reviewing subagent output.
- Always do a final review on the main thread before committing — verify subagent changes against spec.md and decisions.md, check that the database-abstraction rule wasn't violated, and run tests/builds. Never let a subagent commit unreviewed work.

## Working rules

- The database layer must stay storage-agnostic (see the abstraction requirement in spec.md) — never let datastore-specific types or query strings leak outside the adapter.
- When requirements are ambiguous, first check the competition brief and Sessionboard's public behavior; ask the owner only as a fallback, one question at a time with options and a recommendation.

## Testing

- **Unit tests (Vitest) are written as we go, not deferred**: every wave that adds or changes domain/lib logic (`src/domain/`, `src/lib/`, entity schemas) ships colocated `*.test.ts` files for it. Pure logic — conflict detection, template rendering, `.ics` generation, slug/validation rules — must be unit-tested. `npm run test` must pass before every commit, alongside typecheck/lint/build.
- **E2E tests (Playwright, `e2e/`) cover each key product flow once it's implemented** — the flows in spec.md's acceptance path (submit via public CFP, review & accept, portal tasks, agenda placement + conflict, public program). Add or extend a spec in the same wave that lands the flow. `npm run test:e2e` seeds the local D1 database (destructive, like `npm run seed`), swaps `.dev.vars` to port 3010 for the run, and restores it after; it needs the local DB and magic-link log to itself, so never run it while another agent's dev server is up.
- Test real behavior through public interfaces (repos, domain functions, rendered pages) — don't mock what you can run.
