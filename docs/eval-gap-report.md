# Evaluator fix backlog

**Source:** evaluator run 7, `killmysaas-evals/runs/2026-08-11T00-41-30`

**Result:** 93.0% required score, 98.1% weighted coverage

**Prepared:** 2026-08-11

This is the current, deduplicated engineering backlog from the run. It separates
confirmed product defects from findings caused by accumulated evaluator data,
evidence caps, or deliberate product decisions. Do not treat the evaluator's
raw defect array as an implementation plan without this triage.

## P0 — release blockers

### F1. Repair calendar-invite delivery and prove it through the real sender

**Status:** implemented, unit-tested, deployed, and verified with a controlled production send (`status=sent`, no provider error).

**Affected:** Speaker Management (major), Speaker CRM activity feed

**Evidence:** four calendar-invite deliveries failed while ordinary SendGrid
email succeeded. Production `email_log` records the provider response:
`The attachment type cannot contain ';', or CRLF characters.`

The calendar wrapper returns `text/calendar; charset=utf-8; method=REQUEST` and
the SendGrid adapter forwards that complete value as attachment `type`.
SendGrid requires the bare MIME type there.

Acceptance criteria:

- SendGrid attachments use `text/calendar`; browser/feed responses may retain
  their parameterized HTTP `Content-Type`.
- Add a sender-level regression test that rejects or normalizes parameterized
  attachment types rather than relying only on calendar serialization tests.
- Deploy and send a new controlled invitation to a test recipient; verify a
  `Sent` log row and a usable `.ics` attachment. Do not retry the four existing
  failed sends automatically.

### F2. Eliminate recurring Worker request-path stalls

**Status:** reopened; request-time dispatcher import is eliminated but the production stall recurred. Worker `969537a9-f2e0-4611-9d85-2d584a5530d0` replaces OpenNext's generated dispatcher with an equivalent local, statically bound route. Its final Wrangler bundle excludes the generated dispatcher, and a 15-minute mixed-persona soak completed 370/370 requests followed by a 200/200 concurrent burst. A later request on that same deployed version nevertheless reproduced the incident on dynamic `/`: 93,946 ms wall, 20 ms CPU, `outcome=canceled`, no exception, sequence 6 with two active requests. The underlying cross-request trigger remains open.

**Current posture:** treat this as a known unresolved production incident in the current OpenNext 1.20.2-on-Cloudflare-Workers deployment. It has not reproduced in the local Next.js runtime and does not establish a Greenroom product-logic defect, an inherent framework/platform limitation, or a limitation of other deployment targets. Retain the low-risk lifecycle diagnostics and static-dispatch release invariant, but do not carry private OpenNext/Next patches without a trace that identifies the failing promise or exception. F2 remains open; evaluator navigation timeouts and Worker start-without-finish traces must be correlated rather than treated as one clock.

**Affected:** all required areas; explicitly observed on `/`, `/admin`,
`/portal`, event navigation, and Agenda

**Evidence:** repeated 30-second navigation timeouts and blank `Loading…`
states; same-code redeploys restored service during the run.

This recurred after D-082's preload-only implementation, proving the prior fix
did not remove the production trigger from the final bundle.

Why these are known deployment stalls:

- Run-5 probes joined to full Worker traces showed that the request reached the
  Worker, used only 6–77 ms of CPU during 45–210 seconds of wall time, threw no
  exception, and ended `outcome=canceled` because a promise did not complete.
  This rules out CPU exhaustion and strongly rules out D1 as the cause:
  same-second requests performing the same authenticated D1 reads completed in
  118–167 ms, and a cookieless request could stall too.
- Several stalls correlated with concurrent cold-isolate initialization, and
  OpenNext 1.20.2 dynamically imported the generated Next handler inside each
  request. That was a valid request-context risk to remove, but the recurrence
  from a bundle without the dispatcher proves it was not a sufficient cause.
- Affected isolates appeared to remain poisoned and consume later requests.
  A same-code redeploy creates a new Worker version and replaces those isolates,
  which explains the immediate recovery without any database or code change.
- D-082 preloaded the handler and removed cron-only modules from the fetch
  startup graph, but still imported the generated dispatcher. Wrangler's
  minified bundle retained its per-request dynamic-import branch. Production
  version `9badd68b-c1ab-41c6-a612-c5aac509514e` then captured `/` at 50,081 ms
  wall / 23 ms CPU, `outcome=canceled`, no exception, sequence 6 with two active
  requests, while a sibling isolate returned 200. The custom entry now copies
  OpenNext's context/skew/image/middleware routing and calls the statically
  imported handler itself; a dry-run bundle check rejects the generated
  dispatcher. The deployed 370-request soak and 200-request concurrent burst
  both completed without the stall signature, but the same version later
  reproduced it on dynamic `/` at 93,946 ms wall / 20 ms CPU. The bundle check
  remains a valid invariant, not a root-cause claim.

Acceptance criteria:

- Preserve the captured failing-version request/tail trace with Worker version,
  wall/CPU time, outcome, route, isolate, sequence, and concurrent requests.
- Verify Wrangler's final dry-run bundle excludes the generated dispatcher and
  request-time default-handler import.
- Run a sustained deployed smoke across organizer, reviewer, speaker, public,
  and cookieless routes with zero timeouts. A just-deployed cold probe alone is
  not sufficient.

## P1 — highest score and product-value return

### F3. Stop repeated-run duplicates from corrupting workflow state

**Status:** signed-in exact-proposal and exact-task replay guards implemented; existing production duplicates intentionally untouched.

**Affected:** CFP (major), Content (major), Speaker Management, Agenda, CRM

**Evidence:** identical submissions, sessions, tasks, and same-name contacts
propagated into queues, task counts, agenda cards, public schedules, and KPIs.

Split this into safe guards rather than one risky global merge:

- Warn or block a signed-in submitter from creating an identical submitted
  proposal on the same form; preserve legitimate drafts and revisions.
- Make evaluator/admin setup idempotent where a stable identity exists instead
  of creating another task/session on every run.
- Prevent accidental duplicate task creation when event, title, type, and due
  date are identical, with an explicit override if duplicates are intentional.
- Verify that denying a submission cancels only its own converted session and
  cannot leave that same proposal simultaneously denied and scheduled.

Record merge remains excluded by D-065/D-077 and is not part of this item.

### F4. Fix reviewer workspace and assignment controls

**Status:** implemented with controlled reviewer identity, consistent bulk labels, durable reminder counts/timestamp/log context, and focused unit/E2E coverage. Reviewer-only navigation was already correct and now has an exact regression assertion.

**Affected:** Abstract Management, CFP

**Evidence:** the reviewer was shown the organizer-style sidebar, contrary to
`spec.md`; the Assignments-page reviewer selector appeared to revert to Alex
Organizer after Sam Whitfield was selected; reminder sends had no durable
success feedback.

Acceptance criteria:

- Reviewer navigation contains only Overview, Submissions, and Review rounds.
- Selecting a reviewer updates the selected identity and every bulk-action
  label consistently; add an E2E assertion for the selected recipient.
- “Remind reviewers” reports how many reminders were sent or skipped and adds
  an observable timestamp/log entry.

Track-wide read access and the “All talks in your tracks” view remain accepted
under D-061/D-066. D-089 makes that wider view read-only for reviewers: only
explicit round assignments authorize evaluation; the old flat-recommendation
panel and write action are removed rather than maintained as a parallel path.

### F5. Make the public speaker gallery discoverable as a gallery

**Status:** implemented with public and embedded `/gallery` aliases and route coverage.

**Affected:** Public Widgets (major)

**Evidence:** the real gallery is implemented at `/p/<slug>/speakers` and the
embed at `/embed/<slug>/speakers`, but the evaluator's gallery routes returned
404 and the UI did not establish a distinct gallery surface clearly enough.

Acceptance criteria:

- Add canonical or redirecting `/p/<slug>/gallery` and
  `/embed/<slug>/gallery` routes, while keeping existing speaker URLs working.
- Ensure the embed builder labels and generated URL agree on the gallery
  route/view.
- Add route tests and anonymous E2E coverage for the public and embedded
  gallery.

### F6. Fix public detail-modal dismissal

**Status:** implemented by unmounting controlled dialog content as soon as selection clears.

**Affected:** Public Widgets

**Evidence:** “Back to schedule” or “Close” sometimes left an empty blocking
dialog behind; Escape was required to restore the page.

Acceptance criteria: one click, browser Back, and Escape each dismiss the
session/speaker detail exactly once and restore focus to the invoking card.

### F7. Improve content-file and task administration

**Status:** named session links, bidirectional session/file navigation, safe task-shape editing, and explicit digest run counts implemented with focused E2E coverage.

**Affected:** Content Management

**Evidence:** Files showed a generic “N speaker sessions” association rather
than the relevant session names; there was no session-to-files entry point;
task type could not be corrected after creation.

Acceptance criteria:

- Show named, linked session associations for each deliverable and provide a
  session/submission-to-files path.
- Allow task type changes when doing so is safe, or give a specific explanation
  and migration action when existing responses make it unsafe.
- On-demand digest UI explains the 24-hour cooldown and reports selected,
  skipped, and sent counts instead of silently narrowing recipients.

### F8. Tighten speaker-portal feedback

**Status:** implemented for confirm-task convergence and direct file/headshot replacement controls.

**Affected:** Speaker Management

- Task completion must leave `Saving…`, show success/failure, and converge
  without requiring a reload.
- Replacing a headshot should have a direct “Replace” action; requiring removal
  before revealing the upload control is needlessly indirect.

## P2 — polish after the blockers

- **F9 — Room deletion dialog (implemented):** retain the room name while deletion is in
  flight instead of rendering `Delete ""?`; covered in the settings E2E flow.
- **F10 — Segment naming (implemented):** case/whitespace-equivalent saved
  segment names are rejected before creation so unrelated definitions remain distinguishable.
- **F11 — Duplicate-prevention timing (implemented):** manual contact creation
  shows a possible same-display-name match before submission while preserving
  authoritative email identity deduplication.
- **F12 — Navigation/action responsiveness (verified in bounded tests):**
  coordinated portal, rounds, program, and navigation E2E flows passed, and
  the sustained deployed matrix had no stalled RSC requests during that
  matrix. No separate client-navigation defect was reproduced, but F2's later
  same-version recurrence means this is not production-reliability closure;
  keep monitoring through F2's lifecycle diagnostics.

## Not product fixes from this run

These findings should not be scheduled as engineering defects under current
accepted scope:

- **CRM record merge and custom-field builders:** explicitly excluded by
  D-065/D-077; duplicate visibility, links, email deduplication, and tags are
  the chosen behavior.
- **Reviewer track-wide discovery:** explicitly retained by D-061/D-066. The
  assigned queue remains the default; the broader view is deliberate.
- **“Alex Organizer” audit attribution:** this is the saved display name for the
  evaluator account, not evidence that the wrong authenticated actor wrote the
  note.
- **Public bio sentinel and repeated description sentence:** accumulated
  evaluator-authored content, not proof of append-on-edit behavior. Verify edit
  replacement in an isolated test, then clean only with explicit approval.
- **Repeated public sessions and inflated CRM KPIs:** symptoms of accumulated
  run data. F3 should prevent new accidental duplicates; cleaning the existing
  production dataset is a separate destructive operation requiring owner
  approval.
- **Capped SPK-S1/CNT-S3 evidence:** the 120-turn cap lowered coverage; it is not
  itself an application defect.

## Verification and next-run order

1. Fix F1 and exercise a real controlled invitation.
2. Fix/investigate F2 and complete a sustained deployed soak.
3. Land F3–F8 with unit tests for domain/lib changes and E2E coverage for each
   changed key flow.
4. Run `npm run test`, `npm run typecheck`, `npm run lint`, production build,
   and the relevant Playwright suites.
5. Deploy once, record the Worker version, and run the deployed smoke.
6. Request approval before any production evaluator-data cleanup or reset.
7. Rerun the evaluator, then complete its latest manual checklist.
