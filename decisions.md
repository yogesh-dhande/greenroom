# Decisions

Key project decisions with rationale. One entry per decision, newest last. Statuses: **pending** (not yet committed), **accepted**, **superseded** (link to the replacement).

---

## D-001: Language & framework — TypeScript + Next.js on Cloudflare — **accepted**

**Decision:** TypeScript, Next.js (App Router) with Tailwind CSS, deployed to Cloudflare Workers via the OpenNext adapter (`@opennextjs/cloudflare`). Cloudflare Workers cron triggers for scheduled jobs, Resend for email, R2 for file storage.

**Rationale:** Owner preference (TypeScript + Next.js + Tailwind), and the competition brief gives bonus points for Cloudflare deployment and values speed. One codebase covers organizer UI, speaker portal, public embed pages, and API routes.

**Considered and rejected (2026-08-08):** Vite — owner wanted it "if possible", but it's incompatible with Next.js (which bundles via Turbopack, covering the same fast dev-server/HMR role). Owner chose to keep Next.js over switching to a Vite-native framework (React Router v7 / TanStack Start).

## D-002: Primary datastore — Cloudflare D1 + Drizzle ORM — **accepted** (2026-08-08)

**Decision:** Cloudflare D1 (managed serverless SQLite) as primary datastore, accessed via Drizzle ORM — but only inside the SQL adapter. The storage-agnostic repository layer required by [spec.md](spec.md) remains the abstraction (an ORM can't abstract over Airtable, which isn't SQL). Airtable is **not** the primary database; instead a one-way Airtable **export/sync** of accepted speakers/sessions is designed as an optional feature (spec §11) to nod at the competition's Airtable bonus — arguably more useful to the AIE team than Airtable-as-database.

**Rationale:** D1 keeps the full Cloudflare bonus, has no rate limits, no row-level-security gap, no attachment weirdness, and makes auth/form libraries plug-and-play (they ship SQL adapters, not Airtable ones — Airtable-as-primary would have forced hand-rolling, against D-008). D1's 10 GB/database cap is a non-issue at conference scale. Drizzle over Prisma: edge-native, first-class D1 support, and schema definitions largely port SQLite ↔ Postgres, keeping a future Postgres move cheap. Cloudflare offers no managed Postgres (Hyperdrive only proxies external DBs), so D1 is the only fully-Cloudflare-native SQL option.

**Original investigation (Airtable-as-primary, kept for the record):** Airtable could handle all features at conference scale, with four constraints:

**Investigation findings (2026-08-08):** Airtable can handle all required + optional features at conference scale, with four constraints that shape the design rather than block it:

1. **Rate limits:** 5 req/s per base on all plans (429 + 30 s penalty when exceeded); API calls capped at 100k/month on Team plan (unlimited Business+). Public embed/API traffic must be served from a cache (Workers KV / edge), never per-request from Airtable.
2. **No row-level security:** the API token has full base access — all access control (reviewer score isolation, speaker data scoping) must be enforced in the app layer.
3. **Weak attachments:** direct upload capped at 5 MB/file; download URLs expire after ~2 h — cannot back public gallery images. Files go to R2; Airtable stores only the R2 URL.
4. **No transactions or joins:** schedule conflict detection and score aggregation computed in the app; no atomicity for concurrent agenda edits (acceptable for a small organizer team).

Record caps (50k/base on Team) are a non-issue at conference scale. These constraints are why Airtable lost to D1 as primary — but they don't affect the one-way export, which is write-only and low-volume.

## D-003: Calendar invites via `.ics` email attachments — **accepted**

**Decision:** Deliver calendar invites as standards-based `.ics` attachments via email rather than per-provider integrations.

**Rationale:** Works with all three required clients (Gmail, Outlook, iCal) with no OAuth setup per provider.

## D-004: Accelevents integration direction — push, not pull — **superseded by D-017**

**Decision (superseded):** Push accepted sessions/speakers to Accelevents via its API (CSV export as fallback), rather than replicating Sessionboard's pull model — the real integration has Accelevents pull from Sessionboard's public API hosts only ([Accelevents docs](https://support.accelevents.com/en/articles/9049978-sessionboard-integration)).

**Superseded 2026-08-08:** the organizer explicitly dropped the Accelevents requirement; the integration is now out of scope entirely (D-017).

## D-005: Repo hosting — GitHub — **accepted**

**Decision:** Host the repository on GitHub, not Forge.

**Rationale:** Judges will review on GitHub; the Forge bonus is explicitly "teeny" and not worth the workflow risk.

## D-006: Optional features (spec §7–10) — design only, no implementation — **accepted**

**Decision:** For the competition submission, optional features (Accelevents sync, wiki pages, embeds, public API) get designed — data model support, design notes, interface stubs — but not implemented.

**Rationale:** Six firm requirements in ~4 days; design-only keeps the architecture ready without spending build time.

## D-007: Auth — magic links for everyone — **accepted**

**Decision:** Email magic links for all roles (organizers, reviewers, speakers). No passwords anywhere. Implemented with an established auth library per D-008, not hand-rolled.

**Rationale:** Keep it simple; one auth path; speakers were already magic-link by spec.

## D-008: Prefer established frameworks/libraries over hand-rolling — **accepted**

**Decision:** Use existing, well-maintained libraries wherever possible — auth, forms, drag-and-drop, email templating, validation — rather than hand-rolling.

**Rationale:** Owner directive; 4-day deadline favors proven building blocks.

## D-009: Form schema representation — **accepted**

**Decision:** CFP form definitions (fields, conditional logic, category routing) stored as a JSON-serializable custom schema in D1; rendered with an established form library (react-hook-form) and validated with Zod on both client and server (per D-008).

**Rationale:** Conditional logic expressed in standard JSON Schema is clunky; a small purpose-built schema plus proven rendering/validation libraries is simpler and still portable.

## D-010: Cache & invalidation strategy — **accepted**

**Decision:** With D1 as primary (D-002), no separate cache layer is needed for correctness or rate limits. Public pages (CFP, embeds, gallery/schedule, public API) use Next.js caching/ISR with tag-based revalidation on writes; everything else reads D1 directly.

**Rationale:** The KV read-through cache was an Airtable rate-limit mitigation; D1 has no such limit. ISR still gives edge-fast public pages for the speed bonus.

## D-011: AI-assisted review — skip — **accepted**

**Decision:** Skip AI-assisted evaluation entirely — the organizer clarified it is out of scope, and that a *small* useful agentic admin feature (enhancement tier) is worth more than AI scoring. Human `approve/maybe/deny` is the requirement.

## D-012: Accelevents write-API feasibility — **closed (moot)**

Investigation no longer needed — Accelevents integration dropped by the organizer (D-017).

## D-013: Reminder/job mechanics — **accepted**

**Decision:** Plain Cloudflare cron triggers (via the OpenNext scheduled handler) for deadline reminders and future syncs. No Workflows/Queues unless a job later needs multi-step durability.

**Rationale:** Simplest thing that works under the deadline; jobs are idempotent queries + sends.

## D-014: Deployment account & domain — **pending (owner)**

Which Cloudflare account, custom domain vs workers.dev, secret management.

## D-015: Demo & seed data story — **pending**

Seed a realistic sandbox event so judges can test all flows without setup; decide what the walkthrough shows.

## D-016: Auth library — better-auth — **accepted**

**Decision:** better-auth with its magic-link plugin and Drizzle/D1 adapter, implementing D-007 (magic links for everyone). Auth.js v5 is the fallback if better-auth misbehaves on Workers.

**Rationale:** Plug-and-play with the D1 + Drizzle stack (D-002), built-in magic-link support, runs well on Workers — no hand-rolled auth (D-008).

## D-017: Adopt organizer-clarified MVP scope — **accepted** (2026-08-08)

**Decision:** Rebase the spec on the consolidated context ([context/kill-my-saas-context.md](context/kill-my-saas-context.md)), where direct organizer clarifications override the original brief. Headline changes: review workflow minimized to `unreviewed → approve/maybe/deny` (scoring/multi-round demoted to enhancements); agenda MVP narrowed to day/room + drag-and-drop + conflict detection (extra views demoted); acceptance must auto-create speaker/session/tasks; email and calendar delivery must **actually work**, not stubs; Accelevents dropped entirely; AI evaluation out of scope; Airtable sync clarified as write-through for automations + periodic read-back; admin UX for nontechnical operators is the product priority.

**Rationale:** Newer direct organizer statements take precedence over the brief; the competition rewards a working vertical workflow over breadth.

# Appendix: Known divergences from Sessionboard

Where our decisions deliberately don't match how Sessionboard actually works. Recorded so nobody mistakes these for oversights — each is a conscious trade-off tied to a decision above.

| # | Sessionboard | Greenroom | Why acceptable | Ref |
|---|---|---|---|---|
| 1 | Calendar invites via platform calendar integration | `.ics` email attachments (updates = re-sent invite with same UID) | Lands on Gmail/Outlook/iCal without per-provider OAuth; same outcome for the speaker, far less build | D-003 |
| 2 | Native Accelevents connector (Accelevents pulls sessions/speakers hourly) | No Accelevents integration at all | Organizer explicitly dropped the requirement | D-004 (superseded), D-017 |
| 3 | Manages sponsors & exhibitors (and syncs them to Accelevents) | Out of scope — speakers/sessions only (direct session entry covers sponsor *speakers*) | Not in the competition requirements | spec Out of Scope |
| 4 | AI-powered evaluations are a built-in product feature | Skipped; human `approve/maybe/deny` only, small agentic admin helper as possible enhancement | Organizer: out of scope; admin UI is the priority | D-011, D-017 |
| 5 | Full public API: webhooks, contacts/sponsors/exhibitors, media uploads, US/EU regions | Read-only sessions + speakers API, single region, design-only for the competition | Only needed to power embeds and integrations; breadth isn't judged | D-006, spec §10 |
| 6 | Password accounts for organizers/admins (speakers get portal invites) | Magic links for every role, no passwords | Simpler, one auth path; acceptable UX for a small organizer team | D-007 |
| 7 | Embeds, wiki/resources, integrations all shipped features | Designed but not implemented in the competition submission | Six firm requirements in 4 days; architecture accommodates them later | D-006 |
