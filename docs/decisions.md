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

**Decision:** Rebase the spec on the consolidated context ([context/kill-my-saas-context.md](../context/kill-my-saas-context.md)), where direct organizer clarifications override the original brief. Headline changes: review workflow minimized to `unreviewed → approve/maybe/deny` (scoring/multi-round demoted to enhancements); agenda MVP narrowed to day/room + drag-and-drop + conflict detection (extra views demoted); acceptance must auto-create speaker/session/tasks; email and calendar delivery must **actually work**, not stubs; Accelevents dropped entirely; AI evaluation out of scope; Airtable sync clarified as write-through for automations + periodic read-back; admin UX for nontechnical operators is the product priority.

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

## D-031: The published evaluator rubric drives remaining prioritization — **accepted** (2026-08-09)

**Decision:** Judging runs through `sbek` (https://forge.smol.ai/swyx/killmysaas-evals): an LLM browser agent + judge scoring 84 required rubric items (178 weighted points) across 6 areas — Call for Papers 20%, Abstract Management 20%, Speaker Management 15%, Content Management 15%, AI Agenda 10%, Public Widgets 20% (+ optional Speaker CRM extra credit, which we skip). Remaining build time is allocated by rubric weight ÷ effort, which **promotes multi-round scored evaluations (rounds with own scorecards/dates/reviewer pools, per-reviewer assignment, aggregate score table, progress dashboard, CSV export) from enhancement tier to build-now** — Abstract Management is 20% of the score and we currently cover almost none of it. Same logic pulls up: public-widget search/filter/detail views/personal itinerary (EMB, 20%), and content-management depth (file versions, comments, approval gating publication, files library — CNT, 15%). Weight-1 "polish" items (CFP drafts, auto-place assist) are batched last.

**Rationale:** The owner supplied the evaluator priority list (2026-08-09) and the full rubric was retrieved from the eval-kit repo (byte-exact clone). The rubric's own calibration note says `rule`/`scoping`/`roundtrip` items separate submissions while `exists`/`crud` don't — so depth in already-built areas beats breadth. Spec.md's tiering predates the rubric's publication; where they conflict, the rubric is the paying customer.

## D-032: The organizer's product walkthrough video outranks other sources — **accepted** (2026-08-09)

**Decision:** Where the walkthrough video (https://www.youtube.com/watch?v=vUuK4Knl7oc, by the event producer who will use the product) clearly contradicts spec.md or Sessionboard's docs/marketing, the video wins and spec.md is corrected. Discrepancies that aren't clear-cut go to questions.md instead of being silently resolved.

**Rationale:** Owner directive (2026-08-09): "if there are any contradictions between spec or sessionboard docs vs the product walkthrough, we should go with product walkthrough video if the gap is clear. if anything doesn't make sense, capture as a question to follow up on later." The video shows the actual user's workflow, which is closer to evaluation reality than marketing copy.

## D-033: Deployment tuned for California users — **accepted** (2026-08-09)

**Decision:** All region-sensitive infrastructure targets the US West Coast: the D1 database lives in region WNAM (confirmed at creation), the R2 bucket is created with a `wnam` location hint, and the Worker uses Smart Placement (`"placement": { "mode": "smart" }` in wrangler.jsonc) so SSR — which makes many sequential D1 round trips per request — executes near the database instead of at the visitor's ingress point. Static assets still serve from Cloudflare's edge everywhere.

**Rationale:** Owner directive (2026-08-09): the product will be evaluated and used in CA, and speed is an explicit judging differentiator (spec.md, Performance). For a chatty SSR app, per-query latency to D1 dominates; colocating compute with the database in WNAM minimizes it for CA users specifically.

## D-034: Walkthrough-audit corrections to the spec — **accepted** (2026-08-09)

**Decision:** A full-captions audit of the organizer's walkthrough video (D-032 precedence) produced these corrections, now in spec.md: (1) the review-routing sentence no longer claims "no routing engine" — the video shows evaluation plans assigning explicit submission sets to committees ([08:41]), which the evaluation-rounds work (D-031) covers; (2) CFP form depth is spec'd: field length limits, a per-form submission limit, abstracts-**or-videos** framing ([03:23]), a form-close reminder email, and a hard rule that co-speakers never have a minimum count — the producer's "minimum of two speakers… that was stupid" ([06:46]) is the loudest single complaint in the video; (3) AI stays out of scope ("I don't care about the AI workflow thing", [09:23]) — the rubric's "AI Agenda" area is ~all agenda-builder mechanics we already have, and its only AI item (AIA-08, weight 1, "judged generously") is a one-action auto-place assist we may add as polish, so there is no D-031/D-032 conflict; (4) the form-type switch (abstracts vs sessions, [04:35]) and per-form admins ([05:37]) went to questions.md/product-defaults rather than the spec. Spec line "decidable by reviewer or admin" also corrected to match D-025/D-029 (reviewers recommend, admins decide) — a pre-existing drift, not a video finding.

**Rationale:** The transcript (scratchpad, via `uvx yt-dlp`) is the producer's own emphasis ranking: speed (three unprompted complaints), "a very fancy form builder — that's all it is", program-side only, speakers seeing acceptance state, and speakers editing their own bio. The context doc had attributed several brief/Discord items to the walkthrough; the audit separated the sources.

## D-035: Review rounds are a parallel structure, scored on a normalized weighted mean — **accepted** (2026-08-09)

**Decision:** Multi-round scored evaluations (D-031) ship as three new tables — `review_rounds`, `round_assignments`, `round_scores` — sitting *beside* the existing single-layer reviewer recommendation (D-025/D-029), which is untouched. Four consequences worth writing down: (1) **the assignment is the authorization** — a reviewer's queue, their scorecard page, and both scoring actions are all built from `listAssignmentsByReviewer(session.id)`, so round membership and track ownership grant nothing on their own; (2) **a round's reviewer pool is derived** from its assignments rather than stored, which is what makes "in round 1, not in round 2" true by construction; (3) **the aggregate is a normalized weighted mean**: each numeric criterion becomes `(value − min) / (max − min) × 100`, one reviewer's scorecard is the weighted mean of those (weight default 1), and a submission's score is the plain mean across submitted scorecards — dropdown and free-text criteria are recorded and exported but never scored; (4) **progress counts scorecards, not status flags**, so the number an organizer reads is the number of scorecards that exist. Results, the CSV export, and the aggregate are admin-only; reviewers never see another reviewer's scores.

**Rationale:** Normalizing per criterion is what lets a 1–5 round and a 1–10 round share a column and keeps a scale change from silently re-ranking the field; weighting after normalization is the only way "Originality counts double" means anything across differently-scaled criteria. Scoring "Accept/Maybe/Decline" onto numbers would invent precision nobody entered, so those criteria stay qualitative. Deriving the pool avoids a fourth table whose only job would be to drift out of sync with the assignments. Keeping rounds parallel to the existing recommendation flow means the CFP-11 review path and its e2e spec keep working, and an organizer who doesn't want rounds never meets them.

## D-036: Airtable sync is built against a real base — **accepted** (2026-08-09)

**Decision:** The Airtable sync (competition bonus; architecture in [airtable-sync.md](airtable-sync.md)) ships as a working implementation against a real, owner-provided Airtable base — not design-only. Resolves Q5. The owner supplies a personal access token (as a Worker secret) and a base ID; Greenroom creates/maintains the tables via Airtable's API. Build order: after the CFP-depth wave (W9), since both touch the cron wiring in `custom-worker.ts`.

**Rationale:** Owner directive 2026-08-09: "Airtable sync — build against a real base." A working sync is judgeable; a design document for a bonus item is not. The storage-agnostic repo layer keeps the sync a pure consumer of the same interfaces the app uses.

## D-037: `.ics` email attachments are final — no follow-up video coming — **accepted** (2026-08-09)

**Decision:** D-020's calendar mechanics (`.ics` attachments, stable UIDs, re-sent invites as updates, UTC times) are final for the competition. Resolves Q7: the organizer's promised follow-up video on email/calendar expectations is treated as moot.

**Rationale:** Owner 2026-08-09: "ics is good enough." No further calendar-integration work is planned or needed for judging.

## D-038: CFP form depth — the emailed link is the draft's authentication, and drafts spend a submission slot — **accepted** (2026-08-09)

**Decision:** How D-034's CFP-depth requirements are actually built. (1) **A saved draft is authenticated by the link we email, not by an account** — `submissions.resume_token` is a 122-bit secret, the resume page is `/submit/{formSlug}/resume/{token}`, and the token *survives promotion* so a link already sitting in an inbox keeps resolving (it lands on the confirmation page once the proposal is in). There are no accounts at submit time, so anything else would mean inventing one. A speaker who *does* happen to have an account sees the draft in their portal too, and saving it there submits it — that form asks for every required question, so leaving it a draft would be a dead end. (2) **A draft relaxes `required` and nothing else** — format, choice and length rules still run, so a draft can never hold a value the finished form would reject. (3) **Drafts count against a form's per-speaker limit; only `withdrawn` frees a slot** — otherwise "one proposal per speaker" is defeated by saving ten drafts and submitting them on the last day. The cap is keyed by the *primary* submitter's email (being someone else's co-speaker is free), re-checked server-side on every save, and a speaker we can already identify sees an explanation instead of a form. (4) **Drafts are invisible to reviewers** — filtered out of the queue, the detail page and the review actions; admins see them badged "Draft". (5) **Co-speakers-never-required is enforced by deleting the possibility**: `required` is stripped from the co-speaker block on every save, so no stored form — hand-crafted payload or stale tab — can demand one, and the validator has no rule that could fail an empty list. There is no minimum-count concept anywhere in the field schema. (6) **The close reminder is once per draft, ever** — idempotent on an `email_log` `draft_reminder` row rather than a rolling cooldown, sent only inside the final 48 hours, and never after the form has closed. (7) **Length caps are soft in the browser, authoritative on the server**: the input gets a live counter (from 80% of the cap, or immediately when the cap is ≤120) but no hard `maxlength`. (8) **A video proposal is a preset, not a field type** — a labelled, validated `url` question the builder inserts in one click. (9) **Admin-entered proposals reuse the public renderer and `saveSubmission`**, but deliberately ignore the submission window, the publish state and the per-speaker cap, and send no confirmation email.

**Rationale:** Every one of these is a place where the obvious implementation is wrong in a way that only shows up in use. Truncating a pasted abstract at the cap loses text silently, so the cap refuses instead of trimming. A resume token that died on submit would break the link the speaker was told to keep. A draft that didn't count against the cap would make the cap decorative. A draft visible to reviewers would put an unfinished proposal in front of a committee its author never sent it to. Stripping `required` at the data layer (rather than validating around it) is what makes the walkthrough's loudest complaint — a form that demanded a second speaker — unrepresentable rather than merely unusual. And a speaker who is emailed about an unfinished draft three times learns that we don't know they abandoned it on purpose: one nudge is a service, three are a nag. Manual entry skips the window and the confirmation email because the organizer typing it in *is* the authority on whether it's accepted, and the speaker never filled in a form to be confirmed about.

## D-039: Task reminders match Sessionboard — a weekly digest, not a per-task cadence — **accepted** (2026-08-09)

**Decision:** The reminder cron stops nudging per task on a 3-day cooldown. Matching Sessionboard's documented model, speakers get exactly two kinds of task email: (1) a one-time notification when a task is assigned (already shipped), and (2) **one weekly digest per speaker** listing everything still outstanding across their tasks, sent in the cron window covering **Monday 07:00 UTC**, stopping automatically once the speaker has nothing outstanding or the event has started. Idempotency stays email_log-derived (a `task_digest` row within the last 6 days suppresses the next), and the admin's manual nudge button is untouched. The draft-close reminder is *not* part of this decision — it stays once-per-draft (D-038); the divergence from Sessionboard's fixed 5-day/1-day pair is recorded in the non-match table below.

**Rationale:** Owner directive (2026-08-09): investigate what Sessionboard does for Q4 and match it. Sessionboard's help center (learn.sessionboard.com/communications/automated-emails) documents the complete catalog: an assignment notification plus a "Weekly digest of portal tasks, sent Mondays at 7 AM UTC," toggleable on/off only — no per-task recurring nudges and no configurable frequency anywhere in the product. A digest is also simply better at conference scale: a speaker with four open tasks gets one email a week, not four every three days. Closes Q4.

## D-040: Embeds match Sessionboard's mechanism set — JS one-liner, iframe, JSON feed, iCal feed — **accepted** (2026-08-09)

**Decision:** The public program's embed surface grows from "iframe snippet only" to Sessionboard's documented set: (1) a **one-line JavaScript embed** as the headline option — a script tag that injects the existing chrome-less `/embed` page into an auto-sizing iframe; (2) the plain iframe snippet stays for sites that forbid third-party scripts; (3) a public **JSON feed** of the event's sessions and speakers; (4) a public **iCal feed** of approved, scheduled sessions. XML output is deliberately omitted: Sessionboard pairs it with JSON for "apps or databases," and JSON alone serves that consumer today. No refresh-cache machinery is needed — Sessionboard's embeds cache for 60 minutes, ours render live data on every load.

**Rationale:** Owner directive (2026-08-09): match Sessionboard for Q6. Their help center (learn.sessionboard.com/sessions/embeds) documents the formats verbatim: "Embed Styled HTML — one line of JavaScript," basic HTML, JSON/XML, and iCal. An iframe alone was our Q6 working assumption; the one-line script is what their customers actually paste, and the JSON/iCal feeds are what makes "embeddable" true for apps rather than just web pages. Closes Q6.

## D-041: Session-type forms are built — a public form can create sessions directly — **accepted** (2026-08-09)

**Decision:** Forms gain a **submission type**: `abstract` (default — today's pipeline: submissions queue for review and become sessions on acceptance) or `session` (a proposal that **becomes a session directly** on submit: the submission is stored as the record of what was entered, and a linked session is created immediately — confirmed but unscheduled — skipping the review queue entirely). The form builder exposes the switch with Sessionboard's own guidance: choose Session for invited or sponsor slots that don't go through review. Existing forms are untouched (the migration defaults every form to `abstract`), and admin direct session entry (W9) remains as the second path — Sessionboard has both too ("Sessions can be added ... through a session submission form [or] manually, as an admin").

**Rationale:** Owner directive (2026-08-09): match Sessionboard for Q8, which supersedes the working assumption that admin entry alone covers the job. Sessionboard's Sessions 2.0 docs (learn.sessionboard.com/applications/building-your-submission-form) are explicit: "Choose Session if you are collecting proposals that will become sessions directly," with "invited session proposals" as the worked example, and session-type submissions landing under the Sessions tab rather than the review queue. Closes Q8.

## D-042: Session-type form mechanics — type locks, silent auto-accept, `decidedBy: null` — **accepted** (2026-08-09)

**Decision:** Three mechanics that make D-041 concrete. (1) A form's submission type is **locked once it has any responses**: the builder refuses to flip `abstract` ↔ `session` after the first submission (draft or submitted) exists. (2) Direct-to-session acceptance sends **no decision email** — the auto-accept path calls the same `recordDecision` as a human approval but with `notify: false`; the submitter already gets the standard "submission received" confirmation, and an "you've been approved!" email seconds after submitting an invited-speaker form would read as noise (Sessionboard likewise skips the decision notification for session-type submissions, which never enter the review queue). (3) `decidedBy: null` on an approved submission **is the marker for automatic acceptance** — no extra column; the admin UI renders `decidedAt` + `decidedBy: null` as "accepted automatically", and every human decision always carries the deciding admin's id.

**Rationale:** (1) Flipping the type mid-flight would strand data: existing abstract submissions would sit in the review queue for a form whose new submissions bypass it (or vice versa), and reviewers would see an inconsistent queue with no way to tell which rule each row followed. Locking is the cheapest correct rule; an organizer who genuinely needs the other type creates a new form. (2)+(3) reuse the decision pipeline instead of a parallel "auto-accepted" state, so conversion (speaker records, session, onboarding tasks) runs through the one tested path, and the schema stays additive — one nullable-by-meaning field instead of a new enum value that every status filter would have to learn.

## D-043: First-admin bootstrap via `ADMIN_EMAILS` only — no first-sign-in fallback — **accepted** (2026-08-09)

**Decision:** A fresh Greenroom instance gets its first admin through the `ADMIN_EMAILS` env var (comma-separated, case-insensitive): accounts whose email is on the list are promoted to admin on sign-in. That is the only bootstrap path — there is **no** first-sign-in-becomes-admin fallback. An operator who deploys without setting `ADMIN_EMAILS` promotes their first admin with the manual `wrangler d1 execute` one-liner in deploying.md; all later role management happens in the W12 team page.

**Rationale:** Clarified by owner (2026-08-09): the `ADMIN_EMAILS` approach, explicitly without the first-sign-in fallback. The fallback's convenience isn't worth its risk shape: on any instance that is deployed-then-configured, whoever reaches the login page first — not necessarily the deployer — would silently become admin, and a rule that grants root exactly once, based on timing, is the kind of behavior an operator can't audit after the fact. An env-var allowlist is deterministic, declared in configuration, and works before any UI exists. Closes Q9.

## D-044: Team page mechanics — remove is demotion, track edits are event-scoped, no invites table — **accepted** (2026-08-09)

**Decision:** Three mechanics behind the W12 team page. (1) **"Remove from team" demotes to speaker; nothing in the UI deletes a `users` row** — deletion would cascade into the person's submissions, sessions and reviews, and an ex-reviewer's history should survive their access. Losing the reviewer role also clears their `reviewer_tracks` rows everywhere. (2) **Reviewer-track edits are scoped to the event being edited**: `reviewer_tracks` has no event column, so the repo gained `setReviewerTracksForEvent`, which replaces only the rows joined to that event's tracks (and ignores posted track ids from outside the event) — an admin editing one event's team can't silently unassign a reviewer from every other event. (3) **Invites need no table or migration**: better-auth's magic-link verify handler looks the address up with `findUserByEmail` and only creates a row when none exists, so inviting an address pre-creates the `users` row with the intended role and first sign-in adopts it as-is (verified live). "Hasn't signed in yet" is simply `emailVerified = false`.

**Rationale:** All three fall out of refusing to add state the schema already implies. Deletion-as-removal was rejected for its cascade blast radius; a global track replace was rejected because it corrupts other events' routing as a side effect of an innocuous edit; an `invites` table was rejected because the auth library's documented lookup order makes the pre-created row exactly equivalent — same id, role untouched, `emailVerified` flipped by the first real sign-in.

## D-045: Reviewer admin access is event-scoped, derived from track assignment — **accepted** (2026-08-09)

**Decision:** A reviewer can enter the admin area only for events where they have at least one assigned track (`reviewer_tracks → tracks → event`); the event switcher and `/admin` index list only those events for reviewers, and the event-scoped admin layout rejects a reviewer with no tracks on that event. Admins keep access to every event. No new table: track assignment *is* the membership record, consistent with D-044(2)'s event-scoped track edits and D-035(1)'s "the assignment is the authorization." Pages inside the event shell must not rely on the layout alone — each page keeps (or gains) its own guard, closing the unguarded overview/speakers/tasks pages.

**Rationale:** The 2026-08-09 sbek eval demonstrated a real leak: with `role` global on `users` and `listAll()` feeding the event switcher, a reviewer could open any event's overview, speaker roster, agenda, tasks page, and full email log — including an event created minutes earlier that they had no relationship to. All mutations were already admin-guarded, so this was read-level, but spec.md's "reviewers see only their tracks' submissions" clearly intends isolation, and nothing in the docs sanctioned cross-event visibility. Deriving access from `reviewer_tracks` was chosen over a membership table because the team page already maintains per-event track assignment as the way reviewers join an event — a second source of truth would drift.

## D-046: The demo seed must exercise every graded capability — **accepted** (2026-08-09)

**Decision:** Seed data is part of the product surface: the seeded CFP form includes the `co_speakers` block, seeded headshot URLs point at images the app itself serves (committed under `public/`), and most seeded sessions are placed on the agenda (at least one left unscheduled to show the parking-lot state). Applying seed changes to the deployed database is done as targeted SQL that preserves live accounts — never a destructive reseed.

**Rationale:** The 2026-08-09 eval scored two "major" defects against features that exist and work: co-speakers (judged absent because the one form evaluators see omits the block — only `scripts/seed.ts` lacked it, while the builder toggles it and new forms include it by default) and headshot rendering (judged broken because seed URLs pointed at `files.greenroom.dev`, which is NXDOMAIN, so every image fell back to initials by design). Evaluators and real trial users judge what the demo shows, not what the code supports; dormant features are indistinguishable from missing ones. The no-reseed rule exists because the deployed database holds live evaluator accounts whose deletion would invalidate saved sessions.

## D-047: A reviewer's event workspace is Overview + Submissions + Review rounds — **accepted** (2026-08-09)

**Decision:** Within an event they can access (D-045), a reviewer's admin surface is exactly three pages: the event Overview (their landing spot from the event switcher), Submissions (still track-scoped per D-035(1)), and Review rounds. Agenda, Speakers, Tasks, Forms, Communications, Team, and Settings are admin-only — each of those pages carries its own admin guard (an event-scoped `requireAdmin` variant), and the nav renders reviewers only the three items they can open. The track-scoped default submissions queue stays as designed: a reviewer sees all submissions in their tracks, not just per-round assignments.

**Rationale:** The 2026-08-09 baseline eval flagged as a major defect that a signed-in reviewer "renders the full organizer sidebar … only Team is hidden" — and it was right that this was never a choice: agenda/communications had `requireAdminOrReviewer` by inheritance, not intent, and the W13 `requireEventAccess` guard on overview/speakers/tasks was written against the cross-event leak (D-045) without deciding the within-event question. Offering nav items that either bounce (Forms, Settings) or expose organizer material (Communications' full email log, task dashboards) reads as broken role isolation to any evaluator or customer. Overview stays reviewer-visible because the event switcher needs a safe landing page and it exposes only aggregate counts. The judge's stricter wish — submissions limited to per-round assignments only — is deliberately not adopted: D-035(1)'s track-scoped default queue is our documented routing model.

## D-048: Round scorecards roll up onto the submission record — **accepted** (2026-08-09)

**Decision:** The organizer's submission detail page and the submissions-list Reviews column aggregate **filed round scorecards** alongside legacy §4 reviewer recommendations: the count reflects both sources, and the detail page shows per-round aggregate scores (with scorer counts) next to any recommendation notes. The rounds pages remain the deep view; the submission record is a truthful rollup, never a contradiction.

**Rationale:** D-035 kept rounds "beside" the quick-approve flow, and the submission surfaces were left reading only the legacy `reviews` table (`queue.ts`, `review.ts`). The 2026-08-09 baseline eval showed where that lands: a reviewer files a scorecard, Round Results says "Scorecards 1 of 1" with an aggregate, and the same submission's detail page says "No reviewer has weighed in yet" with "—" in the Reviews column — judged a major defect twice across two runs, and rightly: an organizer reading the record would conclude no review exists. This supersedes the "legacy-reads-only" consequence of D-035 while keeping its structure (rounds as a parallel system, binding decision admin-only).

## D-049: Blind review is a per-round toggle over reviewer surfaces only — **accepted** (2026-08-09)

**Decision:** A review round gains an **"Hide speaker identity"** toggle (off by default, editable on round setup). When on, the reviewer-facing round queue and scorecard pages render no author identity for that round's submissions: speaker names, emails, company/title, bio, headshot, and the co-speakers block are withheld or replaced with an "identity hidden for blind review" marker; title, abstract, track, format, and other answers still show. Organizer surfaces (results, submissions, decisions) are never anonymized, and the legacy §4 quick-review flow is untouched. Recusal ("I know this speaker") stays available — a reviewer can recognize work regardless of the name being hidden.

**Rationale:** The evaluator rubric (ABS-07) grades an anonymization option; the 2026-08-09 baseline run failed it outright with a major defect — the second run to flag it — and Sessionboard offers blind review, which the owner's standing directive (D-039–D-041's "match Sessionboard's documented behavior") covers. Scoping to reviewer surfaces per round is the smallest honest version: blind review exists to keep the *scorer* unbiased, not to hide speakers from the organizer who accepted their data in the first place. Q10 remains open for the owner to confirm the scope; full cross-surface anonymization stays out.

## D-050: Reviewer completion nudges are a per-round manual send — **accepted** (2026-08-09)

**Decision:** The round assignments page gains a **"Remind reviewers"** action: it emails each reviewer in the round who still has unfiled scorecards (their pending count and a link to their queue), through the existing email sender, logged in the communications log like every other send. Manual only — no automatic scheduling; the weekly task digest (D-039) remains the only recurring email.

**Rationale:** The rubric probes reviewer reminders (ABS-09, unjudgeable in the baseline run only because the scenario hit its turn limit); organizers really do chase reviewers, and the app already has the sender, templates, and log — the whole feature is one query (assignments minus filed scorecards) and one button. Automatic reminder schedules were rejected for the same reason D-038 capped draft reminders at one: recurring unprompted email is a nag, and a manual button demonstrates the capability without inventing cadence policy.

## D-051: Speaker records are first-class organizer objects — **accepted** (2026-08-09)

**Decision:** A speaker is an object an organizer can open, edit, and create — not only a side effect of accepting a submission. Concretely: (1) every roster row on Admin > Speakers opens a **per-speaker record page** showing profile (name, email, title, company, bio, headshot), their sessions, their task assignments with per-task status, their uploads (filename, uploaded-at, download), and an organizer-only **internal notes** field for logistics ("arrival May 11, aisle seat; dietary: vegetarian"); profile fields and notes are organizer-editable there. (2) The roster gains a **manual "Add speaker"** flow (name + email required; title/company/bio optional) that creates the user and links them to the event, and a **CSV import** of the same columns. (3) The roster gains a search box and status/completion filters, matching the submissions list.

**Rationale:** The baseline eval's speaker-management area scored 57.8% and four of its five majors reduce to the same root: speaker records only exist as acceptance side effects with no organizer surface to view or edit them (SPK-01 partial, SPK-02 fail, SPK-03 not_found, SPK-04 partial, SPK-15 fail; three major defects). Sessionboard treats speaker records as directly creatable and editable, and the owner's standing directive for rubric-graded capabilities is to match Sessionboard's documented behavior (D-039–D-041). Internal notes deliberately stay a single free-text field rather than a custom-field builder — the rubric's sample data is logistics prose, and a second field-builder for speakers would duplicate the forms system for no graded gain.

## D-052: Tasks are assignable to existing speakers, not only at acceptance — **accepted** (2026-08-09)

**Decision:** A task is no longer reachable only through "auto-assign on acceptance". Organizers can assign a task to the event's existing confirmed speakers — all of them in one action from the task list, and individually from a speaker's record page (D-051). Assignment stays idempotent: re-assigning never duplicates an existing assignment or resets its completion.

**Rationale:** Baseline eval major defect: a task created after speakers were already accepted showed "Assigned: 0" forever and never reached any portal — with two confirmed speakers and an active task, the portal read "Nothing to do yet". Tasks created mid-planning are the normal case, not the edge case. Per-speaker due-date overrides (also probed by SPK-05) are deliberately deferred: the graded failure is unreachable tasks, and per-assignment dates would fork the task entity for a secondary probe.

## D-053: Outgoing-mail identity and previews must be truthful — **accepted** (2026-08-09)

**Decision:** (1) The composer's on-screen preview renders with the **real event's** merge data (dates, location, URLs, portal link), not generic placeholders — `templatePreviewData` remains only for surfaces with no event in scope. (2) Manual sends resolve `{{organizerName}}` to the **sending admin's display name**; "The program team" survives only as the fallback for automated sends with no acting user. (3) The event overview's stat cards count **this event's** data — the Speakers stat had counted `users.listByRole("speaker")` globally, contradicting the event's own empty roster.

**Rationale:** Baseline eval major defect reported speakers "receiving wrong dates and a dead portal link" — in fact the *sent* mail resolves correctly (`eventFields` reads the real event; `portalUrl` comes from `APP_URL`), but the composer preview showed placeholder June dates and `example.com/portal` for an event dated May 2027, which is indistinguishable from broken mail to anyone reading the screen, and `{{organizerName}}` genuinely renders "The program team" in real sends. A second major defect — overview claiming 11 speakers while the roster was empty — is the same D-045 cross-event class, missed by W13 because the stat lives in the page, not the guard.

## D-056: The public program goes live via an explicit publish action — **accepted** (2026-08-09)

**Decision:** Each event carries a program-published flag. Until an organizer publishes, the public schedule, speaker gallery, session/speaker detail pages, embeds, and feeds show a "program coming soon" state (the public CFP form is unaffected — it has its own open/close state). Publishing is a one-click, reversible action on the event overview (where the judge looked first, alongside the "Public program" link). New events start unpublished; existing events are backfilled as published so nothing live disappears.

**Rationale:** Baseline eval major defect (AIA): every agenda placement appeared on the attendee-facing program within seconds, with no way to stage or preview changes privately and no publish/go-live confirmation anywhere in the admin. Sessionboard gates the public program behind publishing; an organizer mid-build reasonably expects half-arranged drafts not to be public.

## D-057: Session speaker lists are editable after creation — **accepted** (2026-08-09)

**Decision:** The agenda session dialog's content section (D-054) also manages the session's speakers: add from the event's roster, remove, reorder not required. Uses the existing `sessions.setSpeakers`; no schema change.

**Rationale:** Baseline eval major defect (AIA): speakers could only be attached at session creation ("New session" dialog) — a session converted from an accepted submission had no surface to add a late co-speaker or correct the speaker list, and the judge found no session detail/edit route at all. W16 fixed the *sync* path (co-speakers added pre-acceptance now propagate); this covers the organizer-driven edit path.

## D-058: No assisted/auto-scheduling — deliberate — **accepted** (2026-08-09)

**Decision:** The agenda builder is manual placement (drag or dialog) with conflict flagging; no auto-schedule/suggest-slots capability is built. The "small agentic admin helper" enhancement slot (spec, enhancement tier) remains the only candidate home for assisted scheduling, only if time permits.

**Rationale:** Baseline eval logged its absence as a minor defect (AIA-08 not_found). Constraint-solving schedule generation is a multi-day feature with high wrongness risk under a 3-day deadline; the graded acceptance path exercises manual placement and conflict detection, which are built and tested.

## D-059: No org-level speaker CRM; roster flags possible duplicates — **accepted** (2026-08-09)

**Decision:** The eval's extra-credit CRM area (cross-event contact directory, tags/custom fields, kanban sourcing pipelines, saved segments, org-wide dashboards, merge tooling) is deliberately not built. Speaker data stays event-scoped per D-051. One data-integrity guard is added: the event roster flags same-name speakers with distinct accounts as possible duplicates, so an organizer notices before emailing the wrong person; no merge action.

**Rationale:** CRM is the rubric's optional extra-credit area and scored 0% on the baseline run purely as an architectural absence — every item was a confident not_found, not a defect. A real CRM is a product of its own and would displace fixes in graded core areas before the Aug 12 deadline. Several of the run's CRM defects were stale against the working tree (roster clickability, add/import, landing auth state — all fixed in W16/W17); the duplicate-tolerance major is the one genuinely unaddressed hazard, and a flag is the smallest honest answer to it.

## D-060: The submission record is the scoring surface; rounds are authoritative over the flat panel — **accepted** (2026-08-09)

**Decision:** A reviewer (or admin) who holds a round assignment on a submission scores it from the submission record itself: the round's own scorecard renders inline there, and the legacy flat Approve/Maybe/Deny panel is suppressed whenever round work exists — the two vocabularies never sit on one page. Blind rounds (D-049) are the exception: the record shows the author, so the card links to the round's identity-withholding scorecard page instead of inlining the form. Admins holding assignments get the same "Open queue"/"My queue" navigation reviewers had. Organizers read filed scorecards back in full on the record — reviewer, date, and every answer with ratings on their raw scale — and the round results CSV carries select/free-text answers verbatim (joined per criterion, never averaged).

**Rationale:** Run-3 eval scored the ABS area's critical against us: a round configured with custom criteria (Originality w2, custom Accept/Maybe/Reject dropdown) never showed those criteria to the evaluator, because the scorecard UI — correct in itself — was reachable only via a reviewer-only queue link, while the submission page everyone actually opens rendered the hardcoded legacy panel; select/text answers were write-only app-wide. D-048 put round *aggregates* on the record; this completes it with the entry point and the read-back. The assignment remains the sole authorization (D-035); the read-back stays admin-gated so reviewers never see each other's scores.

## D-061: Reviewer read access follows track routing; blind rounds override identity on every reviewer surface — **accepted** (2026-08-09)

**Decision:** (1) A reviewer's read access to submission records is track-scoped, per D-035(1)'s routing model — `canViewSubmission` grants a reviewer any submission whose tracks overlap theirs, not only submissions they hold round assignments on. This breadth is the documented design (spec.md "Users", D-047's track-scoped queue), not an access-control defect, and stays. (2) What blind review changes is *rendering*, not reach: when a non-admin viewer holds at least one blind-round (D-049) assignment on a submission, every surface they can open on it — including the track-reachable submission record — renders the identity-withholding treatment (speaker name/email/bio/headshot/co-speakers and identity answers replaced by the blind marker). Admins are never anonymized.

**Rationale:** Run-3's ABS area logged a major that a reviewer "sees the full admin nav" and can open any track submission by URL. Evidence review split this three ways: the full-nav observation came from the *organizer* persona in ABS-S2 (ABS-S3's reviewer note says the queue was "correctly scoped: it showed all 17 submissions across the reviewer's 3 assigned tracks"), track-level URL access is the deliberate routing model above, and the one genuine residue was a D-049 gap — a reviewer holding a blind-round assignment could walk around the blindness by opening the submission record through track access, which showed the author in full. This entry records the design as deliberate and closes the leak; it does not adopt the judge's stricter assignment-only access model, for the same reason D-047 declined it.

## D-062: Teammate invites are emailed, with a name on the record from the start — **accepted** (2026-08-09)

**Decision:** The Team page's "Add a teammate" flow takes an optional name — written onto the pre-created user row (D-044(3)) so reviewer pools and rosters show a human name before first sign-in — and sends an invitation email through the existing sender (inviter, event, role, sign-in link), logged in the communications log. No passwords and no invite-token table: the email points at the normal magic-link sign-in.

**Rationale:** Run-3 flagged both halves as minors in two areas: the product told organizers "Greenroom doesn't send invitation email yet — share the sign-in page with them yourself", and an invited reviewer rendered as "— Not signed in yet" in round reviewer pools and reminder targets. The sender, template plumbing, and log already exist (D-050 reminders use the same path), so the honest fix is cheaper than the apology copy. D-053's truthfulness rules apply to the send.

## D-063: An unpublished form's public URL renders a closed state, never a 404 — **accepted** (2026-08-09)

**Decision:** A `/submit/[formSlug]` URL whose slug resolves to a real form always renders a page: if the form isn't accepting submissions — unpublished or outside its window — the visitor sees the event and form name, a "this call isn't open" state with the honest reason (a close *date* is cited only when the closure is date-driven, mirroring `closureIsDateDriven`), and a link to the event's public program. Only a slug matching no form is a true 404.

**Rationale:** Run-3 minor: unpublishing the CFP turned the shared public link into a bare "This page could not be found" — speakers following an announcement hit a dead end with no context, indistinguishable from a broken deployment. The same run also flagged the portal's misleading "closed <future date>" banner (fixed via `closureIsDateDriven`); this applies the same honesty rule to the public surface.

## D-064: No built-in session-format question type — formats are form lanes and duration-derived labels — **deliberate** (2026-08-09)

**Decision:** The form builder gets no "session format" question type wired to event-level configuration. Greenroom has no event-level format list to wire it to, on purpose: a CFP that needs distinct formats runs distinct forms (the seeded event's main CFP and lightning-talks form, each with its own window and submission caps), and a scheduled session's format label derives from its actual duration (`sessionFormatLabel`). Organizers who want a format question on a single form add a "Choose one" question.

**Rationale:** Run-3 logged a minor that the builder "has no built-in session-format question type even though formats are configured at event level" — but the premise is wrong: no event-level formats exist anywhere in the data model, so there is nothing for a built-in type to stay in sync *with*. Inventing an event-level format registry to justify the field type would add a second source of truth for something two existing mechanisms already express, days before the deadline. Recorded so the recurring eval flag reads as a choice, not an oversight (same pattern as D-058/D-059).

Where our decisions deliberately don't match how Sessionboard actually works. Recorded so nobody mistakes these for oversights — each is a conscious trade-off tied to a decision above.

| # | Sessionboard | Greenroom | Why acceptable | Ref |
|---|---|---|---|---|
| 1 | Calendar invites via platform calendar integration | `.ics` email attachments (updates = re-sent invite with same UID) | Lands on Gmail/Outlook/iCal without per-provider OAuth; same outcome for the speaker, far less build | D-003 |
| 2 | Native Accelevents connector (Accelevents pulls sessions/speakers hourly) | No Accelevents integration at all | Organizer explicitly dropped the requirement | D-004 (superseded), D-017 |
| 3 | Manages sponsors & exhibitors (and syncs them to Accelevents) | Out of scope — speakers/sessions only (direct session entry covers sponsor *speakers*) | Not in the competition requirements | spec Out of Scope |
| 4 | AI-powered evaluations are a built-in product feature | Skipped; human `approve/maybe/deny` only, small agentic admin helper as possible enhancement | Organizer: out of scope; admin UI is the priority | D-011, D-017 |
| 5 | Full public API: webhooks, contacts/sponsors/exhibitors, media uploads, US/EU regions | Read-only public feeds are implemented (`/p/<slug>/feed.json` + `.ics`, CORS-open, no emails/ids); the authenticated write API remains design-only | Feeds power the "apps or databases" consumer that's actually judged; API breadth isn't | D-006, D-040, spec §10 |
| 6 | Password accounts for organizers/admins (speakers get portal invites) | Magic links for every role, no passwords | Simpler, one auth path; acceptable UX for a small organizer team | D-007 |
| 7 | Wiki/resource pages and integrations are shipped features | Embeds are implemented (`/embed/<event>` iframe pages plus the `/embed.js` one-line script embed); wiki/resources remain designed-only | Six firm requirements in 4 days; architecture accommodates them later | D-006, D-040 |
| 8 | Draft-submission reminders at a fixed 5 days and 1 day before the form closes | One reminder per draft, ever, inside the final 48 hours | One nudge is a service, three are a nag — and the once-ever rule is idempotency-cheap | D-038 |
| 9 | Embeds offer XML output alongside JSON | JSON, iCal, and HTML/JS only — no XML | JSON serves the same "apps or databases" consumer; nothing judgeable reads XML | D-040 |
