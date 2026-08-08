# Agent Instructions — Greenroom

**Greenroom** — an open-source Sessionboard alternative for the AIE "Kill My SaaS" competition (deadline: Wed Aug 12, 2026, 10 PM PT). Read these three documents before non-trivial work; keep them current as you go — they are the project's memory.

## Project documents

- **[spec.md](spec.md)** — product requirements, the source of truth for *what* we build. Capture all product requirements here and keep them up to date: when scope changes, a requirement is clarified, or a feature is cut/added, update spec.md in the same session — don't let it drift from reality. Keep it concise; no UI/implementation details. Mark optional sections clearly.
- **[decisions.md](decisions.md)** — key decisions with rationale (*why* we build it this way). When a significant technical or product decision is made, add an entry with the decision, rationale, and status (pending/accepted/superseded). Check pending decisions (e.g. the database choice, D-002) before building on an assumption; don't silently resolve a pending decision — surface it to the owner.
- **[learnings.md](learnings.md)** — captured **post hoc**, and only for non-trivial hard-earned knowledge: debugging discoveries, research dead-ends, surprising behavior that cost real effort and contradicted expectations (record expected vs. actual, with evidence). Do NOT log simple known facts, documented behavior, or routine findings. Check it before debugging anything that feels familiar.

## Subagent usage

- Delegate coding and implementation tasks to subagents running an appropriately lower-power model — allowed models are Fable, Opus, and Sonnet only (no Haiku): Sonnet for routine implementation and mechanical edits, Opus for harder pieces, Fable reserved for the main thread and the most complex work. Give each subagent a well-scoped task with the relevant context (spec section, decision IDs, files to touch) rather than the whole conversation.
- Keep the main thread for orchestration, key decisions, and integration: breaking work down, sequencing subagents, resolving anything ambiguous or decision-shaped (log those to decisions.md), and reviewing subagent output.
- Always do a final review on the main thread before committing — verify subagent changes against spec.md and decisions.md, check that the database-abstraction rule wasn't violated, and run tests/builds. Never let a subagent commit unreviewed work.

## Working rules

- The database layer must stay storage-agnostic (see the abstraction requirement in spec.md) — never let datastore-specific types or query strings leak outside the adapter.
- When requirements are ambiguous, first check the competition brief and Sessionboard's public behavior; ask the owner only as a fallback, one question at a time with options and a recommendation.
