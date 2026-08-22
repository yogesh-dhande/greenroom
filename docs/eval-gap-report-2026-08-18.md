# Evaluator fix backlog — run `2026-08-18-stage2-full`

**Source:** sbek viewer, run `2026-08-18-stage2-full` (56 competitors, agent
claude-sonnet-5, judge claude-opus-5). Greenroom is competitor **kms-0006**.

**Result:** overall **80.9%**, coverage 86.9%, flagged `9 harness-lost scenario(s)`.

| Area | Score |
| --- | --- |
| AA — AI agent integration | 92.3% |
| CFP — call for papers | 94.2% |
| PW — public widgets | 87.1% |
| CM — content management | 77.4% |
| AM — abstract management | **70%** |
| SM — speaker management | **65.5%** |

Field is mid-pack: kms-0011 91.5%, kms-0002 85.4%, kms-0010 84.5%,
kms-0019 83.7%, **kms-0006 80.9%**, kms-0018 79.7%.

**Prepared:** 2026-08-22. This backlog is reconstructed from production
telemetry, not from the judge's transcript — see *Evidence sources* below for
what that does and does not prove.

## Evidence sources

Two production sources, both still live at time of writing:

- **Cloudflare GraphQL Analytics** — `workersInvocationsAdaptive` (account
  scope) and `httpRequestsAdaptiveGroups` (zone `usespaces.dev`). Gives
  per-minute path, method, status, and latency quantiles. Zone-scope queries
  are capped at a 1-day range on the free plan and are *sampled*, so low-volume
  paths can be missing entirely — absence of a request group is not proof the
  request never happened.
- **Production D1** — every write the judge made survives.

**Not available:** Workers Logs (`console.*` output and exception traces).
`wrangler.jsonc` sets `observability.enabled: true, head_sampling_rate: 1`, so
the logs exist, but the telemetry API rejects the wrangler OAuth token. Reading
them needs a Cloudflare API token with **Account → Workers Observability →
Read**. Retention is 7 days on Workers Paid, so **the 2026-08-18 logs expire
around 2026-08-25**. Item F3 below cannot be diagnosed without them.

## What the run actually was

Two distinct sessions, not one:

| Session | Window (UTC) | Requests |
| --- | --- | --- |
| `2026-08-18-stage2-full` | Aug 18, 00:52 – 07:42 | 12,886 |
| follow-up / skeptic pass | Aug 19, 20:07 – 21:36 | 6,481 |

The judge drove mostly through `/api/auth/evaluation-login` (81 POSTs) using the
demo personas — `admin@greenroom.dev` (47 sessions), `sbek-speaker` (12),
`sbek-reviewer` (6) — and separately signed itself up through the public CFP and
magic link, creating the `swyx+kms-0006-{speaker,speaker2,reviewer}@ai.engineer`
accounts. Headless Chrome 140, one desktop Chrome, and one iPhone UA.

## Platform health: F2 did not reproduce

Recording this because run 8 left F2 (recurring Worker request-path stalls) open
as a release blocker.

Across both sessions: **zero worker exceptions, zero 5xx**. `errors: 0` in every
hourly bucket. During the run window wall-time p50 was ~9 ms and p99 ~0.4–1.8 s.
Only four client aborts in ~19k requests (`GET / 499` at 00:28 and 03:53,
`POST /api/auth/sign-in/magic-link 499` at 03:06, plus RUM beacons).

This is a sustained deployed run of the kind F2's acceptance criteria asked for,
and it came back clean. It does not prove the trigger is gone — the run did not
reproduce it, which is a weaker claim — but it is the best evidence to date that
the current bundle does not carry it. The `9 harness-lost scenario(s)` flag is
not Greenroom-specific: every scored competitor in the run carries 4–16 of them.

## P0 — the agent surface is unreachable

### F1. OAuth consent page 404s for every dynamically-registered client

**Status:** open. Root cause proven by code inspection; not yet fixed.

**Affected:** AA (AI agent integration). Blocks MCP and the whole `/api/v1`
authenticated surface.

**Evidence.** Minute-level trace, 2026-08-18:

```
03:44  POST 400  /api/auth/oauth2/register     first attempt, malformed
03:45  POST 200  /api/auth/oauth2/register     client "kms-eval" created
03:45  GET  302  /api/auth/oauth2/authorize
03:45  GET  404  /oauth/consent                <- flow dies here
03:46  GET  401  /api/v1/events            x2
03:46  GET  401  /api/v1/events/ai-engineer-summit-2026/sessions
       POST 401  /mcp                      x2
```

The database corroborates it: `auth_oauth_clients` holds two clients the judge
registered (`kms-eval` 03:45:02, `kms-skeptic-eval` 04:31:15), while
`auth_oauth_consents`, `auth_oauth_access_tokens`, and `auth_api_keys` are
**empty — zero rows, ever**. No credential was ever issued, so every
authenticated call 401'd.

**Root cause.** `src/app/oauth/consent/page.tsx:23` calls
`auth.api.getOAuthClient(...)`, which resolves to `getClientEndpoint` in
`@better-auth/oauth-provider`. That endpoint ends with an ownership check:

```js
if (client.userId) {
  if (client.userId !== session.user.id) throw new APIError("UNAUTHORIZED");
} else if (client.referenceId && opts.clientReference) {
  ...
} else throw new APIError("UNAUTHORIZED");   // <- ownerless clients land here
```

`src/lib/auth.ts:161` sets `allowUnauthenticatedClientRegistration: true` so
that MCP public clients can self-register — and those clients are created with
`user_id` and `reference_id` both NULL. Confirmed for both of the judge's
clients. So `getOAuthClient` throws `UNAUTHORIZED` for exactly the clients the
setting exists to support, and `page.tsx:27-29` catches every error and calls
`notFound()`, turning it into a 404.

In short: the consent page uses the **owner-scoped** client lookup on clients
that by design have no owner.

**Fix.** Use the public lookup, which performs no ownership check and returns
`name`/`uri`/`icon`/`tos`/`policy` — and `name` is the only field the page
consumes (`page.tsx:38`):

```ts
client = await auth.api.getOAuthClientPublic({
  headers: await headers(),
  query: { client_id: clientId },
});
```

`getOAuthClientPublic` is exposed on `auth.api` and typechecks against the
current binding (verified). It still requires a session via `sessionMiddleware`,
so the `requireAdmin` guard on `page.tsx:14` remains the authorization boundary.

**Acceptance criteria:**

- Distinguish the failure modes instead of collapsing them: `notFound()` only
  when the client genuinely does not exist; render an error for anything else.
  The blanket `catch { notFound() }` is what hid this.
- E2E: register a client through unauthenticated dynamic registration, run the
  full authorization-code + PKCE flow as an admin, and assert an access token
  comes back and `auth_oauth_consents` gains a row.
- Follow that token into `GET /api/v1/events` and a `POST /mcp` call and assert
  200 rather than 401.

### F2. `/mcp` has no GET handler

**Status:** open.

**Affected:** AA.

**Evidence:** `GET /mcp` returned **405** twice on 2026-08-18.
`src/app/mcp/route.ts:8` exports only `POST`.

The MCP Streamable HTTP transport uses `GET` to open the server-to-client SSE
stream and `DELETE` to terminate a session. A client that probes `GET /mcp`
first — as this one did — sees a bare 405 and cannot tell a misconfigured
endpoint from a POST-only one.

**Acceptance criteria:** export `GET` (and `DELETE`) from the MCP route, or
return a documented JSON error naming the supported transport. Add a route test
asserting the method set.

## P1 — reviewer workflow and discoverability

### F3. No scorecard was ever persisted, in either session

**Status:** open, cause unknown. **Needs Workers Logs — see the retention
deadline above.**

**Affected:** AM (70%, second-lowest area).

**Evidence.** The judge built the review workflow correctly:

- created rounds `Initial Review` (01:18:45, blind) and `Final Review` (01:21:04)
- `Initial Review` opens 2026-08-01, closes 2026-10-15 — **open** during both
  sessions, so `roundState(round) === "open"` and the form's `canScore` is true
- a `round_reminder` email at 01:20:27 reports "2 scorecards waiting in Initial
  Review", so assignments existed on Aug 18
- on Aug 19 it created two fresh assignments (20:14:58, 20:34:46) for
  `swyx+kms-0006-reviewer`, and opened
  `/rounds/feb8cb57/score/263f6aee` 16 times, status 200

And yet `round_scores` contains **only the three seeded rows from 2026-08-13**.
Both Aug-19 assignments are still `pending`. The `reviews` table is likewise
untouched.

The Aug-18 assignments no longer exist, so they were removed or reassigned
mid-run; because `round_scores.assignment_id` is `ON DELETE cascade`, any score
filed against them that day would have been deleted with them. That means Aug 18
is inconclusive. **Aug 19 is not**: those assignments survive, the round was
open, the scorecard page returned 200 to a properly assigned reviewer, and no
score row exists.

What this does *not* prove: that a save was attempted and failed. The judge may
have opened the scorecard 16 times without ever submitting. A failing server
action and an unclicked button are indistinguishable at the HTTP layer — a
Next.js server action that throws still returns 200.

**Acceptance criteria:**

- Pull the Workers Logs for 2026-08-19 20:30–21:20 UTC and look for a throw
  inside `submitScorecard` (`src/app/admin/[eventSlug]/rounds/actions.ts:384`).
- Regardless of that outcome: assert in E2E that an assigned reviewer on an open
  round can fill and submit a scorecard, that `round_scores` gains a row, and
  that the assignment flips off `pending`.
- Give the submit path a visible success/failure state, so a silent failure
  cannot look like an unclicked button again.

### F4. An unassigned viewer opening a scorecard gets a bare 404

**Status:** open.

**Affected:** AM, and plausibly some of the run-8 "link did not navigate"
complaints.

**Evidence:** `src/app/admin/[eventSlug]/rounds/[roundId]/score/[submissionId]/page.tsx:68`
calls `notFound()` when `canScoreSubmission` is false. The gate itself is
correct and deliberate — only an explicit assignment authorizes evaluation
(D-089) — but an **organizer** is never assigned, so an admin following a score
link from the round or results view lands on a generic 404 with no explanation.
To an evaluator that reads as a broken link, not as a permission boundary.

**Acceptance criteria:** render a readable "you are not assigned to this
submission" page that names who is assigned and links back to the round, while
keeping the authorization decision unchanged. Do not widen who may score.

### F5. Conventional public URLs 404

**Status:** open.

**Affected:** PW (87.1%), and discoverability generally.

**Evidence:** the judge guessed these and got 404s (counts from 2026-08-18
unless noted):

`/agenda` (12), `/speakers` (8), `/embed` (6), `/talks` (4), `/gallery` (4),
`/schedule` (3), `/submit` (2), `/cfp` (2), `/events` (2, plus **12 on
2026-08-19**), `/events/devflow-conf-2027` (2), `/events/ai-engineer-summit-2026`,
`/apply/devflow-conf-2027` (4), `/apply`, `/explore` (2), `/public` (2),
`/program`, `/widgets`, `/itinerary`, `/sessions` (6 on 2026-08-19),
`/portal/login`, `/logout`.

The real routes exist and work — `/p/<slug>/schedule`, `/p/<slug>/speakers`,
`/p/<slug>/gallery`, `/embed/<slug>/gallery` are all present, so F5 from run 8
did ship. The gap is that nothing bridges an unslugged guess to them.

**Acceptance criteria:** add redirects from the bare forms to the canonical
slugged routes when the account has exactly one obvious event, or serve a small
index page that lists events and links to their public surfaces. Add route tests
for each alias. Decide explicitly whether a public event directory is in scope —
run 8 recorded it as *not* a current product claim, so this may need a decision
entry rather than an implementation.

### F6. Agent- and crawler-facing discovery files are missing

**Status:** open.

**Affected:** AA, PW.

**Evidence:** 404s for `/openapi.json` (3), `/.well-known/mcp.json` (2),
`/api/health` (2), `/health` (2), `/api` (3), `/api/v1`, `/docs`, `/llms.txt` (3),
`/robots.txt` (7 on Aug 18, 4 on Aug 19), `/sitemap.xml`.

`/api/v1/openapi.json` and `/api/docs` **do** exist and returned 200 — but only
after the judge had already burned turns on the root-level guesses. There is no
`robots.ts` or `sitemap.ts` under `src/app/`.

**Acceptance criteria:** alias `/openapi.json` → `/api/v1/openapi.json` and
`/docs` → `/api/docs`; add `robots.ts`, `sitemap.ts`, and an `llms.txt`
describing the API and MCP entry points; add `/.well-known/mcp.json`. These are
cheap and each one removes a dead end from an evaluator's first five minutes.

## P2 — cost and polish

### F7. The admin nav prefetches all twelve sibling routes on every page view

**Status:** open.

**Evidence:** on 2026-08-18 the sidebar routes were requested in near-uniform
volume — `/admin` 858, `/admin/devflow-conf-2027` 770, `/rounds` 760,
`/communications` 675, `/submissions` 669, `/agenda` 648, `/settings` 614,
`/embeds` 613, `/team` 608, `/forms` 593, `/speakers` 587, `/tasks` 538,
`/files` 534. That flatness is the signature of prefetch, not navigation.

`src/components/admin-nav.tsx:42` renders twelve `next/link` elements with no
`prefetch` prop, so App Router default prefetching fires an RSC request per link
per admin page view. Nothing in `src/` sets `prefetch` anywhere.

Roughly 7,400 of the run's 12,886 requests — about 58% — are attributable to
this. Each is a real Worker invocation doing real D1 work.

**Acceptance criteria:** set `prefetch={false}` on the nav links, or narrow
prefetching to the likely next destinations. Measure the request count for one
scripted admin walkthrough before and after; expect a large drop with no change
in perceived navigation speed.

### F8. Speaker task completion did not converge

**Status:** open, needs reproduction before it is called a defect.

**Affected:** SM (65.5%, lowest area).

**Evidence:** of 17 `task_assignments` created during the run, exactly **one**
reached `completed`. Only one of three `event_speakers` rows carries
`confirmation_status = 'confirmed'`.

This is suggestive but weak on its own — the judge may simply not have worked
the checklist to the end, and low completion is the expected shape of an
exploratory run. Run 8's F8 asked that task completion leave `Saving…`, report
success or failure, and converge without a reload; that work is marked
implemented.

**Explicitly not a defect:** the repeated headshot uploads
(`file_versions` scope `profile` at 01:33:17, 01:37:25, 01:53:47) are the judge
exercising the replace control, which is implemented at
`src/app/portal/task-item.tsx:282` and `src/components/schema-form/field-control.tsx:123`.
Do not reopen run 8's "remove before replace" complaint on this evidence.

**Acceptance criteria:** run the portal checklist end to end against the deployed
build and confirm each task type converges to `completed` without a reload. Only
if that fails does this become a defect with a real root cause.

## What went right

Worth keeping, because the areas that scored well are the ones not to disturb:

- **CFP (94.2%)** was the most heavily exercised path and held up. Draft resume
  tokens worked (three distinct `/submit/call-for-speakers/resume/<token>` hits,
  all 200), accept and deny both delivered decision email, and denying a
  proposal correctly cancelled its converted session — the session
  `"Your AI Pair Programmer Is Lying to You…"` sits at `status = cancelled`,
  which is exactly F3's acceptance criterion from run 8.
- **Edit replacement is correct.** The judge renamed a session to
  `"UPDATED: Taming 40-Minute CI…"` and edited abstracts five times;
  `session_revisions` shows distinct prior and new values with no appending.
  This retires run 8's "public bio sentinel / repeated description" suspicion.
- **Email delivery is healthy.** All 57 sends across both days logged
  `status = sent` with no provider error. No `calendar_invite` send occurred in
  this window, so run 8's F1 fix is still unexercised in production.

## Verification order

1. Fix F1 and F2 together and prove the agent surface end to end — they are the
   cheapest points on the board and currently gate an entire scored area.
2. **Before 2026-08-25**, create the Workers Observability API token and pull the
   2026-08-19 20:30–21:20 UTC logs for F3. That window is the only direct
   evidence of the scorecard failure and it is on a timer.
3. F5 and F6 are mechanical; land them with route tests.
4. F7 before the next evaluator run — it changes the load profile enough to
   affect how any future stall investigation reads.
5. Reproduce F8 locally before scheduling any speaker-portal work.
6. Do not clean production evaluator data without owner approval; that
   restriction from run 8 still stands.
