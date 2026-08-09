# Greenroom — Product Requirements

Open-source speaker & event content management platform: an alternative to [Sessionboard](https://www.sessionboard.com/) (~$40k/yr), built for the AIE **"Kill My SaaS" competition**. The platform takes an event from an open call for speakers to an accepted, scheduled, and onboarded speaker lineup.

**Deadline:** Wednesday, August 12, 2026, 10 PM PT. Submission = organizer's form + open-source repo + deployed, testable site + walkthrough.

**Authoritative source:** [context/kill-my-saas-context.md](context/kill-my-saas-context.md) — consolidated brief, walkthrough video, and Discord organizer clarifications (37 exported pages / 40 Sessionboard screenshots referenced there). Where sources conflict, newer organizer clarifications win. Original references: [competition brief](https://docs.google.com/document/d/1rBHJtiNKHv4i43tdf2Rm0sDEYuIcajhmAPoBKR_Az-A/edit) (see brief for annotated Sessionboard screenshots), [walkthrough video](https://youtu.be/vUuK4Knl7oc), [live CFP example](https://appv2.sessionboard.com/submit/ai-engineer-sandbox-event/b7d4d7cd-3012-45c2-9c08-a8ee9185182f), [schedule embed example](https://wf2025.ai.engineer/schedule), [Sessionboard API docs](https://sessionboard.mintlify.app/introduction).

**Product priority:** a fast, obvious **admin experience for nontechnical event professionals** — real event producers will use it during evaluation. Complete the job, don't clone the interface; a working end-to-end vertical beats broad feature coverage; speed is an explicit differentiator (Sessionboard is slow).

**Users:** event administrator (primary), speaker/submitter, reviewer, public attendee (view-only). Roles: admin, reviewer, speaker — reviewers see only their tracks' submissions; speakers see only their own data.

---

## Core Requirements (required for a credible MVP)

### 1. Event configuration
- Create an event with basic identity, dates, tracks, and rooms — only what the submission, onboarding, and scheduling workflows need. Multi-event capable.

### 2. Call-for-speakers forms
- Multiple configurable public submission forms per event: welcome/explanatory copy, abstract fields (title, description, custom fields), one-or-more track selection, speaker **and co-speaker** info (multi-speaker supported, never required), bio/headshot/supporting-file fields, required-field validation.
- **Basic conditional logic** — no arbitrary rules engine.
- Submission open/close behavior.
- **Working confirmation page and working confirmation email** after submission (explicit must-haves).
- English-only; no payments/fees.

### 3. Public submission flow
- Speakers submit via a public CFP page with no admin access; submissions remain **editable by the submitter** afterward (admin edit-lock deadlines: enhancement).

### 4. Review & decisions
- Routing = track-based responsibility: submissions pick tracks, reviewers own tracks. No routing engine.
- Minimum flow: `unreviewed → approve / maybe / deny`, decidable by reviewer or admin. (Scored reviews, multiple rounds: enhancements. AI-assisted evaluation: out of scope.)
- Organizer-called-out bonus (2026-08-08): email the speaker from inside the app to request changes, and attach feedback when sending the approve/deny decision.
- Admin submission list with clear statuses (rich filters/sorting/columns: important tier).

### 5. Acceptance conversion
- Accepting a submission **automatically creates/confirms the speaker record(s), the session record, and the onboarding tasks** — no manual re-entry.
- Direct session entry for guaranteed speakers (e.g. sponsors) without a submission.

### 6. Speaker portal & onboarding
- Speaker sees their submissions/sessions, acceptance state, and incomplete tasks; edits their own profile, bio, headshot.
- Tasks cover the underlying jobs: complete a form, upload a file (slides, photos), confirm information. Organizer's canonical examples (2026-08-08) — must-have: **hotel stay requirement form**, **flight reimbursement form**; optional: finalize talk description, finalize bio/photos, announce participation, invite colleagues with speaker discount.
- Auth: email magic links for **all roles**, no passwords ([decisions.md](decisions.md) D-007).

### 7. Communications — must actually work (no stubs)
- Real email delivery: submission confirmation, accept/deny messages, change/missing-info requests, task & deadline reminders.
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
- **Airtable sync** (competition bonus; clarified expectation): app-created records land in Airtable so the customer's existing new-row automations run; the app periodically (or on page load) reads back Airtable-side changes. No real-time two-way sync. Exact tables/fields/source-of-truth: open question (see context doc).
- Submission table UX: filters, sorting, columns, statuses.
- Portal resource/wiki pages for speaker guidance, with HTML embeds for existing reference material.

## Useful enhancements (only if time permits)

- Scored reviews / rating fields; multiple evaluation rounds.
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
- **Email:** Resend for delivery + `.ics` calendar attachments (D-003).
- **File storage:** Cloudflare R2 for headshots, slides, documents.
- **Libraries over hand-rolling** (D-008): established libraries for auth, forms, drag-and-drop, validation, email templating.

## Non-Functional Requirements

- **Open source:** public repository (github.com/yogesh-dhande/greenroom, D-005).
- **Performance:** explicit judging bonus and differentiator — fast page loads and responsive interactions everywhere; edge-cache public pages.
- **Operator-friendly:** no technical knowledge (Airtable, APIs, automation internals) required to use the product; event-work terminology.
- **Product judgment:** unspecified states/edge cases are resolved with common sense — the tiebreaker is "would the customer actually use this."
