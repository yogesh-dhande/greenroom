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

**Known exception to the abstraction rule:** `src/lib/auth.ts` imports the Drizzle schema directly — better-auth's adapter requires it. Accepted because auth is infrastructure wiring, not domain logic; a datastore swap replaces the auth adapter alongside the repo adapter.

## D-017: Adopt organizer-clarified MVP scope — **accepted** (2026-08-08)

**Decision:** Rebase the spec on the consolidated context ([context/kill-my-saas-context.md](context/kill-my-saas-context.md)), where direct organizer clarifications override the original brief. Headline changes: review workflow minimized to `unreviewed → approve/maybe/deny` (scoring/multi-round demoted to enhancements); agenda MVP narrowed to day/room + drag-and-drop + conflict detection (extra views demoted); acceptance must auto-create speaker/session/tasks; email and calendar delivery must **actually work**, not stubs; Accelevents dropped entirely; AI evaluation out of scope; Airtable sync clarified as write-through for automations + periodic read-back; admin UX for nontechnical operators is the product priority.

**Rationale:** Newer direct organizer statements take precedence over the brief; the competition rewards a working vertical workflow over breadth. Reconfirmed point-by-point by a second organizer Q&A round on 2026-08-08 (conditional logic, track routing, minimum review flow, auto-conversion, agenda scope, small agentic helper, Accelevents skipped, emails/invites genuinely working); the two scope sharpenings from that round are D-023 and D-024.

## D-018: UI system — shadcn/ui + CSS-variable theme tokens — **accepted** (2026-08-08)

**Decision:** All UI is built from shadcn/ui components (Tailwind v4, CSS-variables mode). Colors/typography flow exclusively through the semantic token set in globals.css (`--primary`, `--accent`, `--muted`, …); components never use raw palette classes (no `bg-green-600`), only token classes (`bg-primary`, `text-muted-foreground`). The brand direction (see design-directions artifact) is applied by swapping the token block only.

**Rationale:** Owner directive; guarantees visual consistency across parallel waves built by different subagents (D-008), and makes the chosen design direction — or any future rebrand — a token-file change rather than a sweep through components.

## D-019: Brand direction — "House Lights", applied in full — **accepted** (2026-08-08)

**Decision:** Of the four mocked-up directions (see design-directions artifact), the owner chose **A "House Lights"** applied in full — warm paper ground (`#F7F6F1`), stage-green primary (`#1F5D45`), amber for attention states (`#C08A2E`), IBM Plex Sans + IBM Plex Mono, and A's own table treatment: comfortable rows (~10px vertical padding), uppercase letter-spaced muted column headers, monospaced/tabular data columns. Implemented per D-018 as the token block in `src/app/globals.css` (plus a matching dark variant), fonts in `src/app/layout.tsx`, and the table primitive. An extra semantic `warning` token pair carries the amber so status UI never hardcodes it.

**Rationale:** Owner choice 2026-08-08. Green-room/stage identity fits the product name; the calm warm ground keeps long admin sessions comfortable while amber flags attention states; Plex is a workhorse family with a matching mono for IDs/times. (An initial owner pick of "A with C 'Call Sheet's compact density" was superseded the same day by full A — cohesion of one direction over a hybrid.)

## D-020: Calendar invite delivery mechanics — **accepted** (2026-08-08)

**Decision:** Refining D-003's `.ics`-by-email: (1) invites ship as a single `text/calendar; method=REQUEST` **attachment** (Resend has no raw-MIME endpoint, so the `multipart/alternative` sibling-part shape is unreachable — and the attachment form is the documented RFC 6047 fallback that Outlook/Gmail/Apple all key on); (2) **times are UTC** instants derived from the event's IANA zone — no TZID is ever emitted (the `ics` lib can't emit VTIMEZONE, and a bare TZID makes Outlook fall back to the recipient's zone; see learnings.md) — with local wall-clock repeated in DESCRIPTION and body copy; (3) UID is derived (`session-<id>@<domain>`), never stored; **SEQUENCE is derived per recipient** by counting prior sent invites in `email_log` (correct per RFC 5546 §2.1.4, no schema change); (4) unknown merge placeholders render empty — speakers never see raw `{{markup}}`; the admin UI validates fields before saving.

**Rationale:** Every choice is the simplest one that renders an actionable, updatable invite in all three required clients; each was verified against the RFCs and vendor documentation rather than assumed (see learnings.md 2026-08-08 entries).

## D-021: Agenda conflicts — blocking vs. advisory severity — **accepted** (2026-08-08)

**Decision:** Conflict detection (spec §9) distinguishes **blocking** conflicts (speaker double-booked, room double-booked — physically impossible) from **advisory** ones (two sessions from the same track overlapping — a legitimate programming choice in a multi-track event). Blocking conflicts get destructive treatment and the summary headline count; advisory use the `warning` token. Neither ever prevents a placement — organizers park sessions deliberately.

**Rationale:** If parallel same-track sessions painted the board red, organizers would learn to ignore red; severity keeps the red channel trustworthy.

## D-022: CFP form composition, submission access & file serving — **accepted** (2026-08-08)

**Decision:** Refinements made while building the form builder + public CFP (spec §2–3): (1) **co-speakers and track selection live inside the form's `fields` JSON** as reserved field types/ids (`co_speakers`, `tracks`, `speaker_bio`, `headshot`) rather than as separate schema columns — the renderer and validator treat them like any field, and the submission service maps them to relational rows on save; the authoritative list of reserved ids lives in `src/db/entities.ts`. (2) **Track options are resolved at render time** from the event's current tracks, not frozen into the form JSON — renaming a track never orphans a live form. (3) **Submitter edits never touch review status**: speakers can edit while the CFP window is open (read-only after), but `status` transitions belong exclusively to the review flow. (4) **Uploads are served at `/files/<key>` capability URLs** from R2, guarded by `isServableKey` (only keys under the upload prefix, no traversal) — no signed-URL infrastructure needed for the competition. (5) **Form management is admin-only**; reviewers see submissions, not builders.

**Rationale:** Keeping speaker-ish structure inside the field JSON preserves the "forms are data" model (D-009) with zero migrations per form change; render-time track resolution and status isolation each close a real corruption path; the `/files` guard is the smallest safe thing that serves headshots publicly (needed later for the speaker gallery anyway).

## D-023: Build in-app change requests + decision feedback (review bonus) — **accepted** (2026-08-08)

**Decision:** The review flow includes emailing a speaker from inside the app to request changes, and attaching a personal feedback message to the approve/deny decision email — implemented in W4a rather than left in the enhancement tier.

**Rationale:** Product-requirement clarification: the organizer's Q&A explicitly named this as the bonus on top of the minimum review workflow. The cost is small because the comms machinery (`sendChangeRequest`, `sendDecisionEmail`) already exists from W2b; only review-page UI and a feedback field ride on top.

## D-024: Canonical onboarding task set — **accepted** (2026-08-08)

**Decision:** The demo/seed task vocabulary uses the organizer's named examples — must-have: **hotel stay requirement form** and **flight reimbursement form**; optional: finalize talk description, finalize bio/photos, announce participation, invite colleagues with speaker discount. The task model must therefore support a small form-response task (a few structured answers plus an optional file) in addition to upload and confirm kinds.

**Rationale:** Product-requirement clarification: these are the examples shown in the organizer's reference video, so the judged walkthrough should surface exactly them; the form-response shape is the minimum that makes the two must-haves real rather than renamed file uploads.

## D-025: Review-decision semantics — **accepted** (2026-08-08)

**Decision:** Four choices fixed while building the review flow (spec §4–5): (1) **binding decisions are admin-only** — spec §4's "decidable by reviewer or admin" is narrowed because accepting now creates a session, onboarding tasks, and a written promise to the speaker; reviewer approve/maybe/deny stays a non-binding recommendation on their review row (change requests are admin-only for the same reason). (2) **Acceptance never mutates user roles** — every submission speaker is already a `users` row; speaker-ness at an event is the session link, not the role column, so an admin/reviewer who also speaks keeps their access. (3) **Accepted sessions are created unscheduled** (no day/room/time) — placement is the agenda board's job. (4) **Reversing an accept cancels the session, never deletes it** — the change stays visible on the board (dashed, struck-through, excluded from conflicts) and a re-accept restores the same agenda item.

**Rationale:** Each choice closes a real failure mode: reviewers triggering irreversible side effects, speakers losing admin access by speaking, phantom auto-scheduled talks, and silently vanishing agenda items. Tie tallies deliberately read as "no leaning" so organizers aren't shown a committee lean that doesn't exist.

## D-026: Per-event template overrides join built-ins by name — **accepted** (2026-08-08)

**Decision:** An event's custom wording for a built-in email template is stored as an `email_templates` row whose `name` equals the built-in's `CommsTemplateId`; resolution is last-write-wins (`resolveCommsTemplate` in `src/domain/comms-templates.ts`). No schema change: the table gets no "overrides which built-in" column, and `trigger` stays many-to-one.

**Rationale:** The overrides feature landed after the table's shape was fixed (W2b), and a join-by-name convention needed zero migration while keeping revert-to-default trivial (delete the row). The cost — an organizer can't have two templates named like a built-in — is invisible in the UI, which only edits the seven built-ins.

## D-027: Walkthrough delivered as a scripted, machine-recorded video — **accepted** (2026-08-08)

**Decision:** The submission walkthrough is `walkthrough.md` (the presenter script) plus `walkthrough.mp4` with `walkthrough.srt` subtitles, recorded by driving the app with Playwright (`playwright.demo.config.ts` + `e2e/demo-walkthrough.record.ts`) against the seeded e2e harness and assembled with ffmpeg. Narration ships as subtitles; the owner can voice over the video later if they choose. The video and subtitles stay out of git (gitignored); the script, recorder, and assembler are committed so the recording is reproducible.

**Rationale:** Answers Q2 — the owner asked us to record the walkthrough once the script was ready (owner directive, 2026-08-08), replacing the earlier working assumption that the owner would record from our script. A scripted Playwright recording is repeatable after every product change, needs no screen-capture session from the owner before the deadline, and doubles as an end-to-end rehearsal of the demo path.

## D-028: "Maybe" decisions stay internal until resolved — **accepted** (2026-08-09)

**Decision:** A waitlist ("maybe") decision changes nothing the speaker sees: the portal keeps showing the submission as in review, and the waitlist email is **default-off** in the decision dialog (an admin can still tick it to notify deliberately). Accept and decline keep their default-on notices. The waitlisted email template stays for the deliberate-notify path.

**Rationale:** Owner directive (2026-08-09), prompted by Sessionboard's accept/decline guide: their queue statuses (Accepted Q / Declined Q) render to speakers as a generic pending icon, and no status change ever auto-emails — a maybe is a holding state for the team, not a promise to the speaker. Our previous behavior (portal badge "Maybe" plus an automatic waitlist email) leaked the team's internal deliberation by default.

## D-029: Q3 closed — admin-only binding decisions ratified — **accepted** (2026-08-09)

**Decision:** D-025's narrowing stands as ratified: binding accept/waitlist/decline is admin-only, reviewer approve/maybe/deny votes remain non-binding recommendations. Q3 is deleted from questions.md.

**Rationale:** Owner approval during the gap-analysis follow-up (2026-08-09). Sessionboard's organizer docs independently match the split: evaluators get view-only access and cannot change session status or contact speakers — only event-team members decide.

## D-030: SendGrid replaces Resend as the production email transport — **accepted** (2026-08-09)

**Decision:** The production transport in `src/lib/email.ts` is SendGrid's v3 `mail/send` HTTP API, keyed by `SENDGRID_API_KEY`; the Resend transport and dependency are removed. The `EmailSender` interface, dev transport, and `email_log` decorator are unchanged, and `.ics` invites keep D-020's single `text/calendar; method=…` attachment shape (SendGrid, like Resend, exposes no raw-MIME path). `EMAIL_FROM_ADDRESS` must be a SendGrid-verified sender — SendGrid has no shared sandbox sender like Resend's `onboarding@resend.dev`.

**Rationale:** The owner already has a SendGrid API key (2026-08-09), which settles the email half of Q1 without a new signup or domain wait. Revises only the email-provider choice inside D-001; everything else there stands.

Where our decisions deliberately don't match how Sessionboard actually works. Recorded so nobody mistakes these for oversights — each is a conscious trade-off tied to a decision above.

| # | Sessionboard | Greenroom | Why acceptable | Ref |
|---|---|---|---|---|
| 1 | Calendar invites via platform calendar integration | `.ics` email attachments (updates = re-sent invite with same UID) | Lands on Gmail/Outlook/iCal without per-provider OAuth; same outcome for the speaker, far less build | D-003 |
| 2 | Native Accelevents connector (Accelevents pulls sessions/speakers hourly) | No Accelevents integration at all | Organizer explicitly dropped the requirement | D-004 (superseded), D-017 |
| 3 | Manages sponsors & exhibitors (and syncs them to Accelevents) | Out of scope — speakers/sessions only (direct session entry covers sponsor *speakers*) | Not in the competition requirements | spec Out of Scope |
| 4 | AI-powered evaluations are a built-in product feature | Skipped; human `approve/maybe/deny` only, small agentic admin helper as possible enhancement | Organizer: out of scope; admin UI is the priority | D-011, D-017 |
| 5 | Full public API: webhooks, contacts/sponsors/exhibitors, media uploads, US/EU regions | Read-only sessions + speakers API, single region, design-only for the competition | Only needed to power embeds and integrations; breadth isn't judged | D-006, spec §10 |
| 6 | Password accounts for organizers/admins (speakers get portal invites) | Magic links for every role, no passwords | Simpler, one auth path; acceptable UX for a small organizer team | D-007 |
| 7 | Wiki/resource pages and integrations are shipped features | Embeds are implemented (`/embed/<event>` iframe pages); wiki/resources and integrations remain designed-only | Six firm requirements in 4 days; architecture accommodates them later | D-006 |
