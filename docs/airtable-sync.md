# Airtable sync — design note

**Status: to be implemented against a real base ([decisions.md](decisions.md)
D-036, owner directive 2026-08-09).** The competition brief lists an Airtable
sync as a bonus ("app-created records land in Airtable so the customer's
existing new-row automations run") without specifying a target base, so this
document was originally the design we'd build once a real base showed up. The
owner has since chosen to build it for real: they provide a personal access
token and a base ID (see [todo.md](todo.md)), and Greenroom creates the tables
itself via Airtable's Metadata API — which resolves the "schema nobody
defined" problem by making this document the schema definition. The
architecture below is what gets built, after the CFP-depth wave (both touch
the cron wiring in `custom-worker.ts`).

## Why the shape below, not a literal two-way mirror

The brief's framing — records created in the app should land in Airtable, and
the app should periodically read back changes made there — describes a
two-way sync. In practice the most defensible, judgeable version of that is
**one-way**: D1 stays the single source of truth, and a projection of it is
pushed to an Airtable base for organizer reporting and their existing
row-triggered automations (Zapier/Make scenarios, Airtable automations, etc.).
Nothing about the app's own behavior — review, scheduling, onboarding state —
would ever depend on data read back from Airtable. The "why not two-way"
reasoning is at the bottom of this doc; skip there if that's the open
question you're weighing.

## Where it plugs in

The storage-agnostic repository layer already required by
[spec.md](spec.md) is what makes this cheap to slot in later. Every
persistence operation in the app goes through the typed interfaces in
`src/db/repos/*.ts` (`EventsRepo`, `SubmissionsRepo`, `SessionsRepo`,
`TasksRepo`, etc., bundled as `Repos` in `src/db/repos/index.ts`), and the
only concrete implementation today is the Drizzle/D1-backed one in
`src/db/repos/d1/`. An Airtable adapter would be a **sibling** package —
`src/db/repos/airtable/` — implementing the same interfaces against Airtable's
REST API instead of D1. That's the abstraction paying for itself exactly as
[decisions.md](decisions.md) D-002 describes: "switching D1 ↔ Postgres ↔
Airtable means implementing a new adapter only."

But a full `Repos` implementation against Airtable is the wrong shape for
*this* feature — it would make Airtable a second primary datastore with its
own consistency and access-control problems (D-002 covers why Airtable lost
that role: no row-level security, 5 req/s rate limit, weak/expiring
attachments, no transactions). The realistic version doesn't implement
`Repos` at all; it's a **projection job**: read the current D1 state through
the existing repos, and write it to Airtable in the shape a reporting base
wants.

## Where it would run

Cloudflare cron triggers already exist for scheduled work
(`wrangler.jsonc` → `triggers.crons`, currently `*/15 * * * *`, wired through
the `scheduled` handler in `custom-worker.ts` which today only calls
`runReminderJob` from `src/domain/comms.ts`). A sync job would be a second
function called from that same handler — `runAirtableSync(repos, airtable)`
in a new `src/domain/airtable-sync.ts` — on its own cadence (every 15–30
minutes is more than adequate for reporting; nothing time-sensitive depends
on it). Like the reminder job, it should also be triggerable on demand from
an admin action, so "sync now" and the cron call the identical function.

## What maps to what

A one-way projection only needs to cover the entities an organizer would
actually report on:

| D1 entity (`src/db/entities.ts`) | Airtable table | Notes |
|---|---|---|
| `events` | Events | One row per event; mostly static after creation. |
| `submissions` | Submissions | Include `status`, `decidedAt`, track names (resolved, not track ids). |
| `users` (speaker role, linked via `submission_speakers`/`session_speakers`) | Speakers | Dedup by email — a speaker on two sessions is one row, matching `src/domain/program.ts`'s `buildGallery` dedup logic. |
| `sessions` | Sessions | Include resolved room/track names and `day`/`startTime`/`endTime`, not internal ids. |
| `tasks` + `task_assignments` | Tasks | One row per assignment (task × speaker), with `status` and `completedAt` — this is the table an organizer's "nudge overdue speakers" automation would actually watch. |

## Field mapping

Each table's column set is that entity's Zod schema in `src/db/entities.ts`
(`eventSchema`, `submissionSchema`, `userSchema`, `sessionSchema`,
`taskAssignmentSchema`, …), with two changes on the way out: internal foreign
keys (`trackId`, `roomId`, `formId`) get resolved to human-readable names —
Airtable users are organizers reading a base, not code — and any field with
no reporting value (e.g. `answers` JSON blobs, internal `decidedBy` user ids)
is dropped rather than dumped as opaque JSON into a cell. Keeping the mapping
schema-derived rather than hand-maintained per field means a new column on an
entity is a one-line addition to the sync, not a silent gap.

## Idempotency

Airtable records need a stable key to upsert against; the D1 primary keys
(UUIDs generated by the app) are that key. Each synced table carries a
`greenroom_id` column holding the source row's id, and the sync does a
find-by-`greenroom_id`-then-update-or-create for every row rather than
blind-appending. This is the same idempotency shape `src/domain/comms.ts`
already uses for reminders (derive state from what's already there,
rather than tracking a separate "have I synced this" flag) — here the
"already there" check is the Airtable read instead of an `email_log` count.

## Rate limits

Airtable enforces 5 requests/second per base (429 + a 30-second penalty
past that, per D-002's investigation). A sync touching a few hundred
records at conference scale needs batching (Airtable's batch endpoints
accept up to 10 records per call) and a delay between batches, not a
request per row. Because the job runs from a cron rather than a
user-facing request, there's no latency budget to protect — it can simply
run slower than the rate limit rather than needing a queue.

## What two-way would additionally require, and why we wouldn't recommend it

The brief's "read back Airtable-side changes" implies at least polling, and
ideally push (Airtable webhooks, on paid plans) for inbound change detection.
Both are buildable, but two further problems come with them rather than after
them:

- **Conflict policy.** Once a record can change on both ends, something has to
  decide who wins when a submission is edited in D1 and its projected row is
  independently edited in Airtable before the next sync — last-write-wins
  by timestamp is the simplest option, but silently overwriting an
  organizer's Airtable edit (or the reverse) is exactly the kind of surprise
  spec.md's "operator-friendly" non-functional requirement warns against.
- **Change detection.** D1 has no changefeed; polling means diffing entire
  tables on every run (fine at conference scale) or adding write-time
  bookkeeping (an `updatedAt` sweep) purely to serve the sync — a real cost
  to the core schema for a bonus feature.

Given that spec.md's actual requirement is "the customer's existing new-row
automations run," a one-way push already satisfies it: automations trigger
off Airtable rows created by the sync, same as they would off rows a human
typed in. Two-way sync would only earn its complexity if organizers needed to
*author* data in Airtable that flows back into the app's own workflows —
nothing in the brief or the organizer's clarifications asks for that, and
[decisions.md](decisions.md) D-002 already established D1, not Airtable,
as the source of truth for everything the app itself acts on.
