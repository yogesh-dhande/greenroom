# Greenroom — Product Requirements

Open-source speaker & event content management platform: an alternative to [Sessionboard](https://www.sessionboard.com/) (speaker/content management SaaS, ~$40k/yr), built for the AI Engineer (AIE) team's **"Kill My SaaS" competition** ([brief](https://docs.google.com/document/u/0/d/1rBHJtiNKHv4i43tdf2Rm0sDEYuIcajhmAPoBKR_Az-A/mobilebasic?pli=1)). The platform manages the full speaker lifecycle: call-for-proposals → evaluation → acceptance → onboarding → agenda → publishing.

**Deadline:** Wednesday, August 12, 2026, 10 PM PT. Submission = open-source repo + deployed, testable site + completion form.

Reference material (see brief for annotated screenshots of each Sessionboard screen: event config, submission forms, public CFP page, speaker portal, abstracts, agenda, tasks, forms, embeds, dashboard):

- Walkthrough video: https://youtu.be/vUuK4Knl7oc
- Live CFP example: https://appv2.sessionboard.com/submit/ai-engineer-sandbox-event/b7d4d7cd-3012-45c2-9c08-a8ee9185182f
- Schedule embed example: https://wf2025.ai.engineer/schedule
- Sessionboard public API docs: https://sessionboard.mintlify.app/introduction

Per the brief, the six core requirements (§1–6) are firm; §7–9 are negotiable / best-effort. AIE does not use every Sessionboard feature — build only what's specified.

---

## Core Requirements (firm)

### 1. Call-for-Speakers Submission Forms
- Organizers create custom submission forms per event: standard fields (name, email, title, company, bio, headshot) plus custom fields (text, select, file upload, etc.).
- **Conditional logic:** fields/sections shown based on earlier answers (e.g. talk format determines follow-up questions).
- **Category routing:** submissions are routed into categories/tracks based on form answers, driving evaluation assignment downstream.
- Public, shareable CFP page per form (no login required to start; see live CFP example above).
- Submissions editable by the submitter until the CFP closes.

### 2. Speaker Portal
- Self-service portal where speakers manage their profile: bio, headshot, slides, and supporting documents.
- Auth: email magic links for **all roles** (organizers, reviewers, speakers) — no passwords anywhere ([decisions.md](decisions.md) D-007).
- **Tasks:** after acceptance, speakers see assigned onboarding tasks (e.g. "upload headshot", "confirm AV needs", "complete speaker agreement form") with deadlines and completion status. Organizers define tasks and attach forms to them.

### 3. Automated Speaker Communications
- Templated emails with merge fields (speaker name, session, deadlines), triggered manually or automatically (on acceptance, task assignment, approaching deadline).
- **Automatic reminders** to speakers with incomplete tasks as deadlines approach.
- **Calendar invites** delivered to the speaker's own calendar — Gmail, Outlook, and iCal. (Recommended: standards-based `.ics` invites attached to email — works with all three clients without per-provider OAuth.)
- Communication log per speaker (what was sent, when).

### 4. Submission Evaluation & Scoring
- Reviewers score and comment on submissions across **multiple rounds** (e.g. screening round → final round), with configurable scoring criteria.
- Reviewer assignment by category/track (from §1 routing).
- Aggregate views: average scores, rankings, accept/reject/waitlist decisions per submission.
- Decision triggers downstream state: accepted speakers enter onboarding (§2, §3).
- **Optional:** AI-assisted review — LLM pre-scores or summarizes submissions to assist human reviewers. Explicitly marked "very optional" in the brief; never a replacement for human scoring.

### 5. Schedule / Agenda Builder
- Drag-and-drop placement of accepted sessions into time slots across rooms and tracks.
- **Automatic conflict detection:** same speaker double-booked, room double-booked, track overlaps.
- Views: list, day, week, track, room.
- Session metadata: title, description, time, duration, room, track, assigned speakers.

### 6. Speaker Onboarding Dashboard
- Real-time organizer dashboard showing per-speaker onboarding status: which speakers have outstanding tasks, what's missing, upcoming deadlines.
- Filterable (by task, track, deadline) so organizers can act (e.g. bulk-remind stragglers via §3).

---

## Secondary Requirements (optional / best-effort)

> Per [decisions.md](decisions.md) D-006: these are **designed for but not implemented** in the competition submission — the data model and architecture must accommodate them (design notes/stubs), but no build time is spent on them.

### 7. Accelevents Integration (one-way) — *optional*
- Goal: eliminate manual re-entry into [Accelevents](https://www.accelevents.com/) (AIE's registration platform).
- How the real integration works ([Accelevents docs](https://support.accelevents.com/en/articles/9049978-sessionboard-integration)): Accelevents **pulls** accepted sessions, speakers, sponsors, and exhibitors from Sessionboard's public API using an API key + Event ID, resyncing hourly. Since Accelevents can only pull from Sessionboard's hosts, this clone should instead **push** accepted sessions/speakers to Accelevents via its API, matching the same field mapping (session: name, date/time, description, location, track, speakers; speaker: name, email, title, company, bio, socials). Fallback: CSV export in Accelevents' import format.
- One-way only (this platform → Accelevents). Only "accepted" items sync.

### 8. Resource / Wiki Pages — *optional*
- Organizer-authored resource pages inside the speaker portal (speaker guidelines, venue info, FAQs).
- **HTML embed support** so existing reference material (docs, videos, slides) can be embedded rather than recreated.

### 9. Embeddable Speaker Gallery & Schedule — *optional*
- Publicly embeddable, mobile-friendly widgets for the event website: speaker gallery (photo, name, title, company) and schedule/itinerary (see embed example above).
- Embeddable via `<iframe>` or script tag; renders from published agenda data (§5).

### 10. Public API — *optional, bonus*
- Token-authenticated read API for sessions and speakers (powers §9 and external integrations), modeled loosely on [Sessionboard's public API](https://sessionboard.mintlify.app/introduction): paginated search endpoints, per-resource GET.

### 11. Airtable export/sync (one-way) — *optional, bonus*
- Cron-driven, one-way export of accepted speakers and scheduled sessions into an Airtable base (the AIE team works in Airtable; competition bonus for Airtable usage).
- Write-only and low-volume, so Airtable's rate limits and attachment constraints don't apply (see D-002); upserts keyed by our record IDs so re-syncs are idempotent.

---

## Tech Stack

- **Language/Framework:** TypeScript, Next.js (App Router) — UI, API routes, and public embed pages in one codebase. Tailwind CSS for styling. (Vite was considered and rejected — incompatible with Next.js, whose Turbopack bundler fills the same fast-dev role; see [decisions.md](decisions.md) D-001.)
- **Datastore:** Cloudflare D1 (managed serverless SQLite) accessed via Drizzle ORM inside the SQL adapter ([decisions.md](decisions.md) D-002). Public pages (CFP, embeds, public API) served via Next.js caching/ISR with tag-based revalidation (D-010); access control enforced in the app layer.
- **Auth:** better-auth (magic-link plugin, Drizzle/D1 adapter) — see D-016.
- **Forms:** react-hook-form + Zod over a JSON-serializable form schema (D-009); Zod entity types shared across forms, services, and API.
- **Database abstraction (requirement):** all persistence goes through a storage-agnostic data-access layer — a typed repository interface per entity (speakers, submissions, forms, scores, sessions, tasks, etc.) exposing CRUD and the query shapes the app needs. No datastore-specific types, ID semantics, or query strings (e.g. Airtable `filterByFormula`, raw SQL) may leak outside the adapter. Business logic (aggregation, conflict detection, access control) must not depend on datastore-specific features, so switching Airtable ↔ Postgres (either direction) means implementing a new adapter only, with no changes to application code.
- **Deployment:** Cloudflare Workers via the OpenNext Cloudflare adapter (`@opennextjs/cloudflare`) (competition bonus). Static assets on Cloudflare's CDN.
- **Scheduled jobs:** Cloudflare Workers cron triggers (or Cloudflare Workflows) for deadline reminders and Accelevents sync.
- **Email:** Resend (noted in the brief as the alternative to Cloudflare's email stack) for templated sends + `.ics` calendar attachments.
- **File storage:** Cloudflare R2 for headshots, slides, and documents (Airtable attachments are size-limited and URL-expiring).

## Non-Functional Requirements

- **Open source:** public repository (strongly preferred by the brief).
- **Performance:** speed is an explicit judging bonus — fast page loads, especially public CFP and embed pages (cache/edge-render them).
- **Multi-event:** data model scoped per event so one deployment serves multiple events (Sessionboard is multi-event; the brief's screenshots show per-event config).
- **Roles:** organizer/admin, reviewer, speaker — reviewers can't see other reviewers' scores mid-round; speakers see only their own data.

## Out of Scope

- Attendee registration/ticketing (Accelevents owns this), sponsors/exhibitors management beyond the optional Accelevents sync, virtual-event streaming, and billing.
- UI/visual design specifics — implementation details; use the brief's screenshots as functional reference only.
