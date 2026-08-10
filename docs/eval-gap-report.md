# Greenroom evaluator and specification gap report

**Audit date:** 2026-08-09  
**Greenroom source:** `8b452628d087dedf8e3367ae72811afc4726dcb9`  
**Evaluator source:** `d99935c3e3c6c50c6b9292220260ccfe2df6d6d4`  
**Evaluator scope:** 84 required items / 178 item-weight points across six required areas, plus 12 optional Speaker CRM items / 19 points. Area weights, not raw item totals, determine the overall score.

## Executive summary

Greenroom has a strong end-to-end core: CFP construction and submission, drafts, review rounds and scorecards, acceptance conversion, communications, agenda conflicts, public schedule/search/itinerary, speaker gallery, file re-upload versions, and cross-role file comments are all implemented. Unit tests, typecheck, lint, and the production build pass.

The highest-value remaining product gaps are concentrated in content management and speaker operations:

1. There is no organizer-settable per-session content approval state, even though both `spec.md` and rubric item CNT-12 require it to gate public output.
2. A task cannot be assigned to a chosen speaker or chosen subset of speakers. The implementation offers auto-assignment and “all confirmed speakers,” while `spec.md` explicitly requires individual assignment from a speaker record and the evaluator exercises assignment to two selected speakers.
3. There is no content-edit audit history/restore, no filtered deliverables dashboard, and no bulk ZIP export.
4. Speaker “Confirmed” is computed and immutable rather than a mutable/filterable workflow status. There is also no explicit speaker portal invitation/welcome action.
5. The public UI combines five rubric widget concepts into two routes. Most functionality is present, but the sessions card lacks the rubric’s in-place “Show more,” the directory and gallery are not distinct, and embed generation has no saved branding/filter/field configuration.
6. Reviewer access deliberately remains track-wide outside a round queue. That is internally documented, but it conflicts with the evaluator scenario that probes an unassigned submission by URL.
7. Auto-scheduling and organization-level CRM are deliberate omissions. Auto-scheduling costs a small required item; CRM only costs optional extra credit.

The immediate release blocker is reliability and evaluator readiness. A fresh official evaluator run against `https://greenroom.usespaces.dev` reproduced the prior deployment hang: CFP-S1 completed, then authenticated `/portal` remained in “Loading…” across repeated 30-second retries. The current local Playwright suite also finishes red: **61 passed, 18 failed**. Most failures are stale test assumptions or a multi-role auth helper that cannot switch users, but until corrected they prevent the suite from proving the key acceptance path.

## Evidence and score baseline

### Official evaluator

The latest completed high-coverage run is `killmysaas-evals/runs/2026-08-09T19-57-52`:

| Area | Score | Coverage |
|---|---:|---:|
| Call for Papers | 83.3% | 97.1% |
| Abstract Management | 73.2% | 100% |
| Speaker Management | 74.1% | 81.8% |
| Content Management | 80.0% | 64.5% |
| AI Agenda | 94.4% | 100% |
| Public Widgets | 89.7% | 100% |
| **Required overall** | **81.8%** | **91.4%** |
| Optional Speaker CRM | 21.1% | 100% |

That run evaluated an earlier deployed build. Several findings from it have since been fixed in source: full round-scorecard readback (D-060), blind identity withholding across reviewer-reachable surfaces (D-061), emailed teammate invitations and honest closed-CFP pages (D-062/D-063), native public facet controls and visible format tags, plus duplicate-record cross-links and speaker email history.

A new run was started at `killmysaas-evals/runs/2026-08-09T23-31-51`. CFP-S1 completed in 41 turns with the builder, conditional field, public form, dropdowns, and validation all observed. CFP-S2 then hit a proposal-limit state from accumulated evaluator data and, after navigating to `/portal`, remained stuck in “Loading…” through turn 22 and repeated 30-second waits. The run was stopped rather than producing a low-coverage score dominated by an unavailable deployment. A clean evaluator event/persona dataset is needed before the next score is comparable.

### Repository validation

| Command | Result |
|---|---|
| `npm run test` | 24 files, **581 tests passed** |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run test:e2e` | **61 passed, 18 failed** in 11.1 minutes |
| Evaluator dry run | All 96 rubric items/specs valid |
| Claude Code evaluator probe | Auth, structured output, and tool loop passed |

No database-abstraction violation was found: datastore-specific schema/query imports remain confined to adapters and the documented auth exception.

## Prioritized work

### P0 — fix before another judged run

#### 1. Diagnose and eliminate authenticated deployment hangs

The fresh evaluator rerun could load and manipulate the public/admin CFP, but authenticated `/portal` repeatedly remained in “Loading…” for several minutes. The prior completed evaluator also reported long authenticated outages that blocked most of Content Management. This is now reproduced after the Workers paid-plan change that `docs/todo.md` says fixed the issue.

Why this matters: availability failures reduce coverage and can prevent otherwise-built features from receiving any score. They also invalidate the acceptance path.

Work needed:

- Capture Worker request logs and D1 timings for `/portal`, `/admin`, and auth/session lookups during a stuck request.
- Add a smoke test that repeatedly loads authenticated organizer, reviewer, and speaker pages against the deployed worker with a hard latency budget.
- Confirm whether accumulated evaluator data causes an unbounded query/N+1 path; the new run also encountered a proposal-limit state immediately, showing the shared demo data is no longer clean.
- Create a repeatable evaluator reset strategy that preserves persona accounts/cookies but clears evaluator-created event content.

#### 2. Restore a trustworthy E2E release gate

The required `npm run test:e2e` gate is red. The 18 failures cluster as follows:

- **Eight multi-role failures:** [`e2e/helpers.ts`](../e2e/helpers.ts) navigates to `/login` without signing out. When a test changes roles in the same browser page, the existing authenticated user is redirected back into their app, so the helper waits 60 seconds for an Email field that cannot appear.
- **Three reviewer-workspace contradictions:** agenda, communications, and team tests still expect reviewer access to admin-only pages, directly contradicting D-047 and current `spec.md`. See [`agenda.spec.ts`](../e2e/agenda.spec.ts), [`comms.spec.ts`](../e2e/comms.spec.ts), and [`team.spec.ts`](../e2e/team.spec.ts).
- **Three stale seed assumptions:** agenda tests expect “Evals…” and “Tool schemas…” to be unscheduled even though D-046 now deliberately pre-places most sessions; the submission-limit test says “one proposal” while the seeded lightning form now permits two.
- **Three stale selectors/interactions:** the digest test opens a confirmation dialog but never clicks “Send digest”; one round assertion matches two copies of a speaker name; the team track test finds two generic “Edit” buttons in the same row.
- **One cascade:** the round aggregate expectation fails because the preceding scorecard test did not complete.

These are mostly test defects, not evidence that 18 product flows are broken. They are still release-blocking because the suite can no longer distinguish regressions from deliberate product changes.

#### 3. Implement per-session content approval and public gating (CNT-12, weight 3)

This is a direct implementation gap against [`spec.md`](spec.md), not merely evaluator polish.

Current state:

- [`src/db/entities.ts`](../src/db/entities.ts) has only `draft | confirmed | cancelled` session statuses.
- New/accepted sessions normally become `confirmed` immediately.
- [`src/domain/program.ts`](../src/domain/program.ts) exposes every `confirmed` session publicly once the event-wide publish flag is on.
- No organizer UI changes a session’s content-review/approval state.

Required outcome:

- Add an explicit content state such as `draft | in_review | approved` (separate from cancellation and agenda placement).
- Add an organizer control on session/content management.
- Filter public pages, embeds, JSON, iCal, gallery, and itinerary through the same approval rule.
- Add E2E coverage proving one approved session appears and one unapproved session does not.

### P1 — highest expected rubric return

#### 4. Add targeted task assignment (SPK-05/CNT-01 and `spec.md` §5)

[`spec.md`](spec.md) requires post-acceptance tasks to be assignable to all confirmed speakers from Tasks **and individually from a speaker record**. The implementation explicitly says individual assignment is absent in [`src/app/admin/[eventSlug]/speakers/[speakerId]/page.tsx`](../src/app/admin/[eventSlug]/speakers/[speakerId]/page.tsx); the Tasks page can assign to all confirmed speakers, not a selected subset.

Add a multi-select on task creation/edit and an “Assign task” action on the speaker record. Preserve existing idempotency.

#### 5. Complete the content-management surface (CNT-07, CNT-11, CNT-14)

The central Files page is real and already shows latest/older versions plus a shared comment thread, but it has no filter controls or bulk selection.

Missing work:

- **CNT-07:** filters for completion/status, task type, speaker, and due/overdue state; show every speaker-task pair, including incomplete requests with no uploaded file. The current Files page lists deliverables only after a file exists.
- **CNT-11:** audit history for session title/abstract and speaker profile edits, with editor, timestamp, diff/value, and restore. File-version history does not satisfy content-edit history.
- **CNT-14:** select multiple deliverables/sessions and download a ZIP containing the latest version of each, with optional grouping by session or speaker.

#### 6. Add mutable speaker workflow status and a dedicated portal invitation (SPK-04/SPK-06)

Current “Confirmed” is derived from whether the speaker has a session; the only roster status filter is task completion. There is no persisted organizer-controlled workflow state such as Invited/Confirmed/Declined.

Add an event-speaker workflow status field, editable on the roster/record and filterable in the roster. Keep task completion separate.

For onboarding, Communications can send a manually composed message with `{{portalUrl}}`, and acceptance/task emails already link to the portal, but no explicit “Send portal invitation/welcome” action was found. Add a per-speaker or selected-speakers action that uses a named template, reports success, and writes the communications log.

#### 7. Improve public-widget rubric fit (EMB-01/EMB-12/EMB-15)

The combined public routes are functionally strong, and the previous judge passed anonymous access to all implemented concepts. Remaining mismatches:

- Session descriptions are line-clamped and open a modal from the title; EMB-01 explicitly asks for an in-place “Show more” expansion on the card.
- The speaker directory and photo gallery are one identical grid, so EMB-12 previously received partial credit for lacking a visually distinct gallery.
- The embed area only exposes schedule/speakers plus JSON/iCal links. It has no widget-type builder covering most of the five concepts, no saved branding/colors, no field selection, and no baked-in content filters.

At minimum, add in-card expansion and an embed configuration object for view, filters, visible fields, and theme. Creating five wholly separate code paths is unnecessary; distinct configured views over shared components should satisfy the rubric with less maintenance.

#### 8. Reconcile reviewer assignment scoping with the evaluator (ABS-05 scenario tension)

Greenroom correctly has an exact per-round queue and round score URLs reject submissions not assigned in that round. However, the general Submissions list and detail authorization remain track-scoped: [`src/app/admin/[eventSlug]/submissions/[id]/page.tsx`](../src/app/admin/[eventSlug]/submissions/[id]/page.tsx) authorizes any overlapping reviewer track. D-061 explicitly preserves that breadth.

The evaluator scenario assigns one talk, expects exactly one reviewer item, then attempts the unassigned talk by guessed URL. The rubric text says exact assigned-queue scoping belongs to ABS-05, while the scenario probes broader access. This is an explicit product/rubric contradiction, not an accidental bug.

Recommended resolution: keep a track-scoped discovery queue only if it is essential, but make a reviewer with active round assignments land in the exact round queue and block the round’s unassigned records on all scoring entry points. If the team chooses to keep general read access, record that the likely evaluator defect may remain.

### P2 — deliberate trade-offs or lower return

#### 9. Auto-place assist (AIA-08, weight 1)

D-058 and `spec.md` deliberately reject auto-scheduling, while required rubric item AIA-08 awards any one-action assisted placement. This is a known contradiction. A simple deterministic “place next unscheduled session in the first conflict-free slot” would satisfy the rubric without building an AI scheduler, but it should follow the content and reliability work above.

#### 10. Session-format configuration (CFP-S1/D-064)

The evaluator asks for five event-level formats and a format dropdown. Greenroom deliberately has no event-level format registry: CFP forms use custom choose-one fields or separate form lanes, while public format labels derive from scheduled duration. The seeded form can demonstrate the evaluator’s five choices, so this is mostly setup/discoverability risk, but the answer does not round-trip into a canonical session format.

Either add a small event-level format registry and a first-class form field, or keep D-064 and accept the recurring evaluator caveat. Do not maintain an unlinked custom answer that appears canonical but has no effect downstream.

#### 11. Portal resource/wiki pages

`spec.md` lists speaker resource/wiki pages with HTML embeds as “Important / strongly desired,” but no route or data model was found. This is not scored by the current evaluator and is lower priority than the required-area gaps.

#### 12. Organization-level Speaker CRM (optional area)

D-059 explicitly keeps CRM out of scope. Current per-event speaker records earn limited partial credit (search, CSV import, notes, duplicate flags, email history), but there is no cross-event directory, attribute filters/tags, saved segments, sourcing pipeline/history, reuse-across-events action, merge, or org dashboard. This does **not** reduce the required overall score; implement only if core areas are green and extra credit is strategically worthwhile.

## Area-by-area discrepancy summary

| Area | Strong/currently implemented | Remaining discrepancy |
|---|---|---|
| CFP (20%) | Configurable forms, validation, conditional fields, draft/resume email, editing, close state, confirmation, decisions, notifications, acceptance handoff | D-064 format model differs from scenario; shared evaluator personas can hit proposal caps; verify close-date persistence in a clean rerun |
| Abstract (20%) | Multiple rounds, per-round pools, numeric/dropdown/text scorecards, weights, exact round queue, bulk track assignment, blind review, progress, reminders, aggregates, recusal, CSV, organizer readback | General submission access remains track-wide outside exact round queues; AI review intentionally absent and only scored if claimed |
| Speaker (15%) | Searchable roster, add/edit, CSV, profile round-trip, scoped portal, tasks, uploads, sessions, progress, bulk email, merge fields, logistics notes, weekly reminders | Mutable workflow status, selected-speaker task assignment, and explicit portal invitation are absent |
| Content (15%) | File requests, portal upload, scoping, file versions, cross-role comments, constraints, session/profile edit, central Files library | Per-session approval gate, content edit history/restore, complete filtered deliverables matrix, and ZIP export are absent |
| Agenda (10%) | Multi-day room grid, manual placement, speaker/room conflicts, move/unschedule persistence, explicit reversible publish | Auto-place absent by decision; E2E agenda fixtures are stale |
| Public (20%) | Search/count, track/room/format facets, details, day navigation, itinerary, persistence, ICS, gallery search/fallback/detail, embeds/feeds, live consistency | In-card expansion, distinct list/gallery presentations, and configurable embeds are incomplete |
| CRM (optional) | Per-event roster/import/notes/duplicate hints/email history | Nearly every organization-level CRM capability is deliberately absent |

## Documentation contradictions and drift

These should be corrected so future work does not build on stale instructions:

1. **D-006 is still accepted but is superseded in practice.** It says embeds and public API are design-only; D-040 and current routes implement JS/iframe embeds plus JSON/iCal feeds. Mark D-006 superseded or rewrite it to retain only the wiki/resource omission.
2. **D-014 and D-015 remain pending despite completed deployment and seed decisions.** Deployment/domain is recorded complete in `docs/todo.md`; D-046 defines the demo seed. These pending entries should be resolved/superseded.
3. **Q10 is stale.** `docs/questions.md` says blind review is an open question and “being built,” while `spec.md`, D-049/D-061, schema, UI, and tests treat it as built and accepted. Either close it into a new decision or rewrite it as the narrower unresolved policy question.
4. **D-052/spec versus code:** `spec.md` requires individual assignment from a speaker record, but the speaker-record source explicitly states that action is deliberately absent.
5. **D-061 versus evaluator scenario:** track-wide read access is an accepted decision, while the evaluator probes an unassigned submission URL and treats the breadth as a defect.
6. **D-058 versus AIA-08:** no assisted scheduling is deliberate, but the capability is a required, if low-weight, rubric item.
7. **D-064 versus CFP-S1:** no event-level format registry is deliberate, while the evaluator explicitly configures five event formats.
8. **D-059 versus optional CRM:** the product deliberately omits the entire extra-credit area. This is a transparent scope choice, not an implementation surprise.
9. **`docs/todo.md` is stale:** evaluator dependencies and all three saved persona sessions exist, but their checklist entries remain unchecked. It also claims the paid Workers plan fixed authenticated hangs, which the fresh rerun contradicted.
10. **E2E expectations contradict D-047:** tests still expect reviewers to read Agenda and Communications and expect a Communications nav link, while current spec/code correctly limit the reviewer workspace to Overview, Submissions, and Review rounds.

## Recommended execution order

1. Fix deployed authenticated hangs and create a clean evaluator reset path.
2. Repair E2E auth switching, stale seed assumptions, and D-047 expectations; require 79/79 green again.
3. Add per-session content approval and shared public-output gating.
4. Add selected/individual task assignment, speaker workflow status, and explicit portal invitations.
5. Add deliverables filters/missing rows, content audit/restore, and ZIP export.
6. Add public card expansion and configurable embed views.
7. Make the reviewer access decision explicitly: match the evaluator’s assignment-only probe or accept the known loss.
8. Only then consider the one-click auto-place point, portal wiki, or optional CRM.

## Bottom line

The implementation is much closer to the rubric than the last completed 81.8% score suggests because several of that run’s critical/major findings have been fixed in current source. The next score is more likely to be limited by **deployment reliability and incomplete content-management depth** than by the core CFP/review/agenda/public workflow. Stabilizing the deployed authenticated routes and restoring a green E2E gate are prerequisites; after that, per-session approval plus targeted speaker/task operations offer the clearest required-score return.
