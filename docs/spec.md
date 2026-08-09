# Greenroom — Product Requirements

Open-source speaker & event content management platform: an alternative to [Sessionboard](https://www.sessionboard.com/) (~$40k/yr), built for the AIE **"Kill My SaaS" competition**. The platform takes an event from an open call for speakers to an accepted, scheduled, and onboarded speaker lineup.

**Deadline:** Wednesday, August 12, 2026, 10 PM PT. Submission = organizer's form + open-source repo + deployed, testable site + walkthrough.

**Authoritative source:** [context/kill-my-saas-context.md](../context/kill-my-saas-context.md) — consolidated brief, walkthrough video, and Discord organizer clarifications (37 exported pages / 40 Sessionboard screenshots referenced there). Where sources conflict, newer organizer clarifications win. Original references: [competition brief](https://docs.google.com/document/d/1rBHJtiNKHv4i43tdf2Rm0sDEYuIcajhmAPoBKR_Az-A/edit) (see brief for annotated Sessionboard screenshots), [walkthrough video](https://youtu.be/vUuK4Knl7oc), [live CFP example](https://appv2.sessionboard.com/submit/ai-engineer-sandbox-event/b7d4d7cd-3012-45c2-9c08-a8ee9185182f), [schedule embed example](https://wf2025.ai.engineer/schedule), [Sessionboard API docs](https://sessionboard.mintlify.app/introduction).

**Product priority:** a fast, obvious **admin experience for nontechnical event professionals** — real event producers will use it during evaluation. Complete the job, don't clone the interface; a working end-to-end vertical beats broad feature coverage; speed is an explicit differentiator (Sessionboard is slow).

**Users:** event administrator (primary), speaker/submitter, reviewer, public attendee (view-only). Roles: admin, reviewer, speaker — reviewers see only their tracks' submissions; speakers see only their own data. A reviewer's admin-area access is **event-scoped**: they can open only events where they have assigned tracks — the event switcher, admin index, and every event page enforce it (admins see all events; D-045).

---

## Core Requirements (required for a credible MVP)

### 1. Event configuration
- Create an event with basic identity, dates, tracks, and rooms — only what the submission, onboarding, and scheduling workflows need. Multi-event capable.
- **Team management** from the admin UI: an admin promotes accounts to admin or reviewer, removes access, assigns each reviewer their tracks for the event, and adds someone by email (an address with no account yet is pre-created, so their first magic link lands with the intended role — no invitation email is sent; the admin shares the sign-in URL). Removing the last admin is refused. The first admin on a fresh deployment comes from the `ADMIN_EMAILS` env var (D-043).

### 2. Call-for-speakers forms
- Multiple configurable public submission forms per event: welcome/explanatory copy, abstract fields (title, description, custom fields), one-or-more track selection, speaker **and co-speaker** info (multi-speaker supported, never required), bio/headshot/supporting-file fields, required-field validation.
- Each form has a **submission type** (D-041): *abstract* forms collect proposals that go through review before becoming sessions; *session* forms collect proposals that become confirmed (unscheduled) sessions the moment they arrive, skipping review entirely — invited speakers and sponsor slots. Existing forms are abstract forms.
- **Basic conditional logic** — no arbitrary rules engine.
- Field-level validation beyond required-flags: length limits on text fields (walkthrough calls out Sessionboard failing its own "standard validation rules", D-034).
- Proposals may be **abstracts or videos** — a video is just a URL/file field, but the form builder should name the option so it's discoverable (D-034).
- Optional per-form **submission limit** per submitter (D-034).
- Co-speakers can never be required and never have a minimum count — the producer's own "minimum of two speakers" misconfiguration is the walkthrough's loudest complaint (D-034).
- Submission open/close behavior, with a close-reminder email to submitters with unfinished work (D-034; also Important tier).
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

### 5. Acceptance conversion
- Accepting a submission **automatically creates/confirms the speaker record(s), the session record, and the onboarding tasks** — no manual re-entry.
- Direct session entry for guaranteed speakers (e.g. sponsors) without a submission — also reachable through a session-type form, whose submissions run the same conversion automatically on arrival (D-041).

### 6. Speaker portal & onboarding
- Speaker sees their submissions/sessions, acceptance state, and incomplete tasks; edits their own profile (name, title, company, bio, social/web links) and headshot, which feed the admin roster and public gallery. The profile editor must be **reachable from the portal navigation** — a page that exists only by URL doesn't count.
- Tasks cover the underlying jobs: complete a form, upload a file (slides, photos), confirm information. Organizer's canonical examples (2026-08-08) — must-have: **hotel stay requirement form**, **flight reimbursement form**; optional: finalize talk description, finalize bio/photos, announce participation, invite colleagues with speaker discount.
- Auth: email magic links for **all roles**, no passwords ([decisions.md](decisions.md) D-007).

### 7. Communications — must actually work (no stubs)
- Real email delivery: submission confirmation, accept/deny messages, change/missing-info requests, task & deadline reminders.
- Task reminders are a **weekly per-speaker digest** of everything still outstanding (sent Mondays 07:00 UTC), not a per-task cadence; it stops when the checklist is clear or the event starts, and admins can send it on demand (D-039).
- **Working calendar invitations** compatible with Gmail, Outlook, iCal (`.ics`, D-003). No video-meeting links; include room when known; support sending initially without a room and updating the invite after room assignment.
- Templated messages with merge fields (important tier); communication log per speaker.

### 8. Onboarding visibility for admins
- Clear view of which accepted speakers still have missing bios, headshots, forms, files, or other incomplete onboarding work.

### 9. Agenda builder
- Day-based scheduling with room assignment, **drag-and-drop placement**, and **conflict detection**: speaker double-booked and room double-booked (track/resource conflicts where applicable).
- Additional views (list/week/track/room): enhancement tier.

---

## Important / strongly desired

- Submission close dates and deadline reminders; draft/incomplete submission handling.
- Templated communications; supporting-document and slide uploads.
- Public, mobile-friendly **speaker gallery** and **schedule**, embeddable on an external website.
- **Airtable sync** (competition bonus): app-created records land in Airtable so the customer's existing new-row automations run — implemented as a one-way periodic push (events, speakers, submissions, sessions, tasks) against a real owner-provided base; Greenroom creates and maintains the tables itself (D-036). Read-back of Airtable-side edits is not built; the app remains the source of truth.
- Submission table UX: filters, sorting, columns, statuses.
- Portal resource/wiki pages for speaker guidance, with HTML embeds for existing reference material.
- **Multi-round scored evaluations** — *built* (promoted from enhancement tier by the evaluator rubric, D-031; design in D-035): two or more named review rounds, each with its own open/close dates, scorecard (numeric, dropdown, free-text criteria; numeric criteria carry weights), and reviewer pool. Organizers assign submissions to a named reviewer individually or a whole track at once; each reviewer's queue contains exactly their assignments and nothing else, and they may recuse themselves from one with a reason the organizer sees. Per-submission aggregate score in a table sortable by score, per-reviewer progress counts, and CSV export of scores and statuses. Rounds sit alongside the §4 recommendation flow rather than replacing it; the binding decision stays admin-only (D-025, D-029).
- **Content-management depth** (D-031): file re-upload creates versions (latest marked, older accessible); comments on uploaded files (author + timestamp, cross-role); a session approval status that gates what the public program shows; a central files library across sessions.
- **Public program depth** (D-031): keyword search (titles + speaker names) and track filters on the sessions/schedule views; speaker directory search; session and speaker detail views; personal itinerary (star sessions, persists, `.ics` export). Session surfaces (cards, detail view, feeds) carry speaker **name, title, and company** and a short description snippet; a speaker card's talk list labels not-yet-scheduled talks ("time to be announced") so the gallery never silently disagrees with the schedule.

## Useful enhancements (only if time permits)

- Configurable edit-lock deadlines; admin notification customization.
- Additional agenda views (week/track/room); dashboards and reporting; saved views/configurable columns.
- Generalized CMS/embed tooling; API beyond what the UI needs (public read API modeled on Sessionboard's — bonus).
- A **small** useful agentic feature that reduces real admin work (narrow assistant, not a chatbot).

## Out of scope

- Payments; **Accelevents integration** (organizer explicitly dropped it); CRM and marketing functionality; content transcription/repurposing; full Sessionboard CMS recreation; AI-assisted evaluation; large agentic systems; multilingual forms; video links in calendar invites; pixel-level Sessionboard fidelity; attendee registration/ticketing.
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
- **Demo credibility:** the seeded demo event must actually exercise the graded capabilities — the live CFP form includes the co-speakers block, seeded headshot URLs resolve to real images served from the app's own origin, and most seeded sessions are placed on the agenda (D-046). A feature the demo data leaves dormant reads as missing to every evaluator.
