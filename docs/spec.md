# Greenroom — Product Requirements

Open-source speaker & event content management platform: an alternative to [Sessionboard](https://www.sessionboard.com/) (~$40k/yr), built for the AIE **"Kill My SaaS" competition**. The platform takes an event from an open call for speakers to an accepted, scheduled, and onboarded speaker lineup.

**Deadline:** Wednesday, August 12, 2026, 10 PM PT. Submission = organizer's form + open-source repo + deployed, testable site + walkthrough.

**Authoritative source:** [context/kill-my-saas-context.md](../context/kill-my-saas-context.md) — consolidated brief, walkthrough video, and Discord organizer clarifications (37 exported pages / 40 Sessionboard screenshots referenced there). Where sources conflict, newer organizer clarifications win. Original references: [competition brief](https://docs.google.com/document/d/1rBHJtiNKHv4i43tdf2Rm0sDEYuIcajhmAPoBKR_Az-A/edit) (see brief for annotated Sessionboard screenshots), [walkthrough video](https://youtu.be/vUuK4Knl7oc), [live CFP example](https://appv2.sessionboard.com/submit/ai-engineer-sandbox-event/b7d4d7cd-3012-45c2-9c08-a8ee9185182f), [schedule embed example](https://wf2025.ai.engineer/schedule), [Sessionboard API docs](https://sessionboard.mintlify.app/introduction).

**Product priority:** a fast, obvious **admin experience for nontechnical event professionals** — real event producers will use it during evaluation. Complete the job, don't clone the interface; a working end-to-end vertical beats broad feature coverage; speed is an explicit differentiator (Sessionboard is slow).

**Users:** event administrator (primary), speaker/submitter, reviewer, public attendee (view-only). Roles: admin, reviewer, speaker — reviewers see only their tracks' submissions; speakers see only their own data. A reviewer's admin-area access is **event-scoped**: they can open only events where they have assigned tracks — the event switcher, admin index, and every event page enforce it (admins see all events; D-045). Within an event, a reviewer's workspace is **Overview, Submissions, and Review rounds only** — every other admin page (agenda, speakers, tasks, forms, communications, team, settings) is admin-only, enforced per-page and hidden from the reviewer's nav; a reviewer must never be shown the full organizer sidebar (D-047).

---

## Core Requirements (required for a credible MVP)

### 1. Event configuration
- Create an event with basic identity, dates, tracks, and rooms — only what the submission, onboarding, and scheduling workflows need. Multi-event capable.
- **Team management** from the admin UI: an admin promotes accounts to admin or reviewer, removes access, assigns each reviewer their tracks for the event, and adds someone by email with an optional name (an address with no account yet is pre-created carrying that name, so their first magic link lands with the intended role and reviewer pools show a human name before first sign-in); adding someone sends an **invitation email** — inviter, event, role, sign-in link — through the normal sender, logged in the communications log (D-062). No passwords, no invite tokens. Removing the last admin is refused. The first admin on a fresh deployment comes from the `ADMIN_EMAILS` env var (D-043).

### 2. Call-for-speakers forms
- Multiple configurable public submission forms per event: welcome/explanatory copy, abstract fields (title, description, custom fields), one-or-more track selection, speaker **and co-speaker** info (multi-speaker supported, never required), bio/headshot/supporting-file fields, required-field validation.
- Each form has a **submission type** (D-041): *abstract* forms collect proposals that go through review before becoming sessions; *session* forms collect proposals that become confirmed (unscheduled) sessions the moment they arrive, skipping review entirely — invited speakers and sponsor slots. Existing forms are abstract forms.
- **Basic conditional logic** — no arbitrary rules engine.
- Field-level validation beyond required-flags: length limits on text fields (walkthrough calls out Sessionboard failing its own "standard validation rules", D-034).
- Proposals may be **abstracts or videos** — a video is just a URL/file field, but the form builder should name the option so it's discoverable (D-034).
- Optional per-form **submission limit** per submitter (D-034).
- Co-speakers can never be required and never have a minimum count — the producer's own "minimum of two speakers" misconfiguration is the walkthrough's loudest complaint (D-034).
- Submission open/close behavior, with a close-reminder email to submitters with unfinished work (D-034; also Important tier). A public form URL that resolves to a real form always renders a page: when the form isn't accepting submissions (unpublished or outside its window) visitors see a "this call isn't open" state with the honest reason — a close date is cited only when the closure is date-driven — and a link to the public program; only an unknown slug 404s (D-063).
- **Working confirmation page and working confirmation email** after submission (explicit must-haves).
- English-only; no payments/fees.

### 3. Public submission flow
- Speakers submit via a public CFP page with no admin access; submissions remain **editable by the submitter** afterward (admin edit-lock deadlines: enhancement).
- Submitters can **save an unfinished proposal as a draft** and resume it from an emailed link — no account needed. Drafts don't reach reviewers until submitted (D-038; see Important tier). A **signed-in** speaker who returns to the public form while holding a draft on it sees a resume notice linking to that draft instead of a silently blank form.
- Admins can **enter a proposal on a speaker's behalf** from the admin area (invited talks, abstracts that arrived by email), using the event's own form questions (D-038).

### 4. Review & decisions
- Routing: submissions pick tracks and reviewers own tracks — the default scoping for the review queue. The walkthrough additionally shows evaluation plans that assign explicit submission sets to a reviewing committee (D-032, D-034), and the evaluator rubric tests exact per-reviewer assigned queues — covered by the evaluation-rounds work (D-031).
- Minimum flow: `unreviewed → approve / maybe / deny`; reviewers record recommendations, admins record the binding decision (D-025, D-029). Multi-round scored evaluations are built as a parallel structure (see Important tier; D-031, D-035). AI-assisted evaluation: out of scope — the producer: "I don't care about the AI workflow thing" (D-034).
- A "maybe" is internal to the team: speakers keep seeing the proposal as in review until it's accepted or declined, and no waitlist email goes out unless the admin explicitly opts in (D-028).
- Organizer-called-out bonus (2026-08-08): email the speaker from inside the app to request changes, and attach feedback when sending the approve/deny decision.
- Admin submission list with clear statuses (rich filters/sorting/columns: important tier).

### 5. Acceptance conversion & speaker records
- Accepting a submission **automatically creates/confirms the speaker record(s), the session record, and the onboarding tasks** — no manual re-entry.
- Direct session entry for guaranteed speakers (e.g. sponsors) without a submission — also reachable through a session-type form, whose submissions run the same conversion automatically on arrival (D-041).
- But acceptance is not the *only* way in: speakers are **first-class organizer objects** (D-051). Every roster row opens a per-speaker record page — profile, sessions, task assignments with per-task status, uploads (filename, date, download), and an organizer-only internal logistics notes field — with profile and notes editable there (social/web links are deliberately speaker-owned and edited only in the portal, D-051). The roster supports **manual "Add speaker"** and **CSV import** (name + email required; title/company/bio optional), plus search and status/completion filters. Same-name speakers with distinct accounts get a **possible-duplicate flag** on the roster *and* on each colliding record page, where the notice links to the other records for side-by-side comparison (no merge tooling — D-059/D-065). The record page also shows the speaker's **email history** (every logged send to their address, newest first). The organizer can supply a speaker's headshot from the record page (D-054); headshots are tracked in the files system like any other upload, with versions (D-076).
- **Confirmation status**: a speaker's Confirmed state is derived from session attachment by default, and the organizer can override it with a stored Confirmed/Declined from the record page — the stored value wins everywhere confirmation is shown, filtered, or used to build a recipient/assignee set, so a declined speaker never receives "confirmed speakers" bulk actions (D-068).
- Tasks must reach speakers who already exist: a task created after acceptance is assignable to the event's confirmed speakers — all at once from the task list, to a chosen subset at task creation, individually from a speaker record — idempotently, never duplicating or resetting an existing assignment (D-052, D-069).

### 6. Speaker portal & onboarding
- Speaker sees their submissions/sessions, acceptance state, and incomplete tasks; edits their own profile (name, title, company, bio, social/web links) and headshot, which feed the admin roster and public gallery. The profile editor must be **reachable from the portal navigation** — a page that exists only by URL doesn't count.
- Tasks cover the underlying jobs: complete a form, upload a file (slides, photos), confirm information. Organizer's canonical examples (2026-08-08) — must-have: **hotel stay requirement form**, **flight reimbursement form**; optional: finalize talk description, finalize bio/photos, announce participation, invite colleagues with speaker discount.
- Auth: email magic links for **all roles**, no passwords ([decisions.md](decisions.md) D-007). An organizer can send a speaker a **portal invitation email** from the record page — what to expect plus a sign-in link, logged like any other send; re-sendable, no one-time tokens (D-070).

### 7. Communications — must actually work (no stubs)
- Real email delivery: submission confirmation, accept/deny messages, change/missing-info requests, task & deadline reminders.
- Task reminders are a **weekly per-speaker digest** of everything still outstanding (sent Mondays 07:00 UTC), not a per-task cadence; it stops when the checklist is clear or the event starts, and admins can send it on demand (D-039).
- **Working calendar invitations** compatible with Gmail, Outlook, iCal (`.ics`, D-003). No video-meeting links; include room when known; support sending initially without a room and updating the invite after room assignment.
- Templated messages with merge fields (important tier); communication log per speaker.
- The composer's preview shows the **real event's** merge values, and manual sends sign with the **sending admin's name** — a preview with placeholder dates or an `example.com` link is indistinguishable from broken mail (D-053). Admin stat cards (overview) count only their own event's data (D-045, D-053).

### 8. Onboarding visibility for admins
- Clear view of which accepted speakers still have missing bios, headshots, forms, files, or other incomplete onboarding work.

### 9. Agenda builder
- Day-based scheduling with room assignment, **drag-and-drop placement**, and **conflict detection**: speaker double-booked and room double-booked (track/resource conflicts where applicable).
- A session stays editable after creation: the session dialog edits title, abstract, and track (the session record the public program reads — never forked onto the submission), and manages the speaker list from the event's roster (D-054, D-057).
- The public program is gated behind an explicit, reversible **publish** action per event; unpublished events show a "program coming soon" state on all public/embed program surfaces while the CFP form keeps its own open/close state (D-056). New events start unpublished.
- Assisted/auto-scheduling is deliberately not built (D-058); placement is manual. The one assist: a per-session **"Suggest a slot"** that proposes the earliest conflict-free day/time/room for the session being edited — a suggestion the organizer confirms, never batch scheduling (D-067).
- Additional views (list/week/track/room): enhancement tier.

---

## Important / strongly desired

- Submission close dates and deadline reminders; draft/incomplete submission handling.
- Templated communications; supporting-document and slide uploads.
- Public, mobile-friendly **speaker gallery** and **schedule**, embeddable on an external website.
- **Airtable sync** (competition bonus): app-created records land in Airtable so the customer's existing new-row automations run — implemented as a one-way periodic push (events, speakers, submissions, sessions, tasks) against a real owner-provided base; Greenroom creates and maintains the tables itself (D-036). Read-back of Airtable-side edits is not built; the app remains the source of truth.
- Submission table UX: filters, sorting, columns, statuses.
- Portal resource/wiki pages for speaker guidance, with HTML embeds for existing reference material.
- **Multi-round scored evaluations** — *built* (promoted from enhancement tier by the evaluator rubric, D-031; design in D-035): two or more named review rounds, each with its own open/close dates, scorecard (numeric, dropdown, free-text criteria; numeric criteria carry weights), and reviewer pool. Organizers assign submissions to a named reviewer individually or a whole track at once; each reviewer's queue contains exactly their assignments and nothing else, and they may recuse themselves from one with a reason the organizer sees. A reviewer holding active round assignments lands on that assigned view when they open the submissions list, with a one-click widen to their full track-scoped list — presentation only, access unchanged (D-066). Per-submission aggregate score in a table sortable by score, per-reviewer progress counts, and CSV export of scores and statuses. Rounds sit alongside the §4 recommendation flow rather than replacing it; the binding decision stays admin-only (D-025, D-029). Round results must also surface on the **submission record itself**: the organizer's submission detail and the submissions-list Reviews column roll up filed round scorecards alongside §4 recommendations — the record must never claim "no reviews" while a round holds a filed scorecard for it (D-048). The record is also the **scoring surface**: a viewer holding a round assignment on the submission gets that round's scorecard inline right there (blind rounds instead link to the round's identity-withholding page), and the flat §4 panel never renders alongside round work — the round's vocabulary is authoritative when one is configured (D-060). Organizers read filed scorecards back in full on the record — reviewer, date, every answer with ratings on their raw scale — and the CSV export carries dropdown/free-text answers verbatim, never averaged (D-060). Each round carries a **"Hide speaker identity" toggle** (off by default): a blind round withholds every trace of the author — name, email, bio, headshot, co-speaker block, including identity answers inside the form's answer list — from the *reviewer's* queue and scorecard, replaced by a single "identity hidden" marker; title, abstract, tracks, and custom answers still show, recusal stays, and organizer surfaces are never anonymized (D-049). The withholding follows the viewer, not the page: reviewer read access is track-scoped by design (D-035, D-047), so a non-admin who holds a blind-round assignment on a submission gets the identity-withheld rendering on *every* surface they can reach for it, including the track-reachable submission record (D-061). From a round's assignments page an organizer can manually **"Remind reviewers"** — emailing exactly those with unfiled scorecards their pending count and queue link, logged in the communications log; no scheduled variant (D-050).
- **Content-management depth** (D-031): file re-upload creates versions (latest marked, older accessible); comments on uploaded files (author + timestamp, cross-role); a session **content approval status** (draft/in review/approved) separate from scheduling status — only approved content appears on public surfaces, existing content grandfathered as approved (D-072); **abstract revision history** — every edit to a session's abstract records who/when/prior value, viewable on the session with a per-entry restore that is itself recorded, history append-only (D-071); a central files library across sessions and profile uploads, showing each file's session(s), with a one-click **"Download all" ZIP export** of every current file grouped by speaker (D-073).
- **Public program depth** (D-031): keyword search (titles + speaker names) and track filters on the sessions/schedule views; speaker directory search; session and speaker detail views; personal itinerary (star sessions, persists, `.ics` export). Session surfaces (cards, detail view, feeds) carry speaker **name, title, and company** and a short description snippet; a speaker card's talk list labels not-yet-scheduled talks ("time to be announced") so the gallery never silently disagrees with the schedule.

## Useful enhancements (only if time permits)

- Configurable edit-lock deadlines; admin notification customization.
- Additional agenda views (week/track/room); dashboards and reporting; saved views/configurable columns.
- Generalized CMS/embed tooling; API beyond what the UI needs (public read API modeled on Sessionboard's — bonus).
- A **small** useful agentic feature that reduces real admin work (narrow assistant, not a chatbot).

## Out of scope

- Payments; **Accelevents integration** (organizer explicitly dropped it); CRM and marketing functionality — including the eval's extra-credit org-level speaker CRM (cross-event directory, tags, sourcing pipelines, segments, org dashboards; D-059 — speaker data stays event-scoped, with a possible-duplicate flag on the roster as the sole guard); content transcription/repurposing; full Sessionboard CMS recreation; AI-assisted evaluation; large agentic systems; multilingual forms; video links in calendar invites; pixel-level Sessionboard fidelity; attendee registration/ticketing.
- UI/visual design specifics — the brief's screenshots are functional reference only.

---

## Acceptance path (demo walkthrough the product must support)

Create/open event → configure & publish CFP form → submit a realistic talk via public form → find it in admin → route to the correct track reviewer → review & accept → see resulting speaker + session + tasks → complete/inspect portal work → send a real email + calendar invite → place session on agenda → trigger and resolve a conflict → view the public program.

## Tech Stack

- **Language/Framework:** TypeScript, Next.js (App Router) — UI, API routes, and public embed pages in one codebase. Tailwind CSS for styling. (Vite rejected — incompatible with Next.js; see [decisions.md](decisions.md) D-001.)
- **Datastore:** Cloudflare D1 (managed serverless SQLite) accessed via Drizzle ORM inside the SQL adapter (D-002). Public pages served via Next.js caching/ISR with tag-based revalidation (D-010); access control enforced in the app layer.
- **Auth:** better-auth (magic-link plugin, Drizzle/D1 adapter) — D-016.
- **Forms:** react-hook-form + Zod over a JSON-serializable form schema (D-009); Zod entity types shared across forms, services, and API.
- **Database abstraction (requirement):** all persistence goes through a storage-agnostic data-access layer — typed repository interfaces per entity exposing CRUD and the query shapes the app needs. No datastore-specific types, ID semantics, or query strings (Drizzle/SQL, Airtable formulas) may leak outside the adapter. Business logic (aggregation, conflict detection, access control) must not depend on datastore-specific features, so switching D1 ↔ Postgres ↔ Airtable means implementing a new adapter only.
- **Deployment:** Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`) — competition bonus. Cron triggers (custom worker) for reminders and syncs (D-013).
- **Email:** SendGrid for delivery (D-030) + `.ics` calendar attachments (D-003).
- **File storage:** Cloudflare R2 for headshots, slides, documents.
- **Libraries over hand-rolling** (D-008): established libraries for auth, forms, drag-and-drop, validation, email templating.

## Non-Functional Requirements

- **Open source:** public repository (github.com/yogesh-dhande/greenroom, D-005).
- **Performance:** explicit judging bonus and differentiator — fast page loads and responsive interactions everywhere; edge-cache public pages.
- **Operator-friendly:** no technical knowledge (Airtable, APIs, automation internals) required to use the product; event-work terminology.
- **Product judgment:** unspecified states/edge cases are resolved with common sense — the tiebreaker is "would the customer actually use this."
- **Demo credibility:** the seeded demo event must actually exercise the graded capabilities — the live CFP form includes the co-speakers block and at least one custom non-text question (a choose-one "Audience level"), seeded headshot URLs resolve to real images served from the app's own origin, most seeded sessions are placed on the agenda, and per-speaker submission limits leave headroom for a demo visitor to actually submit (D-046). A feature the demo data leaves dormant reads as missing to every evaluator.
