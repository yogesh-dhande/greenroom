# Greenroom

Open-source speaker & event content management platform — an alternative to
[Sessionboard](https://www.sessionboard.com/). Call-for-proposals → evaluation
→ acceptance → onboarding → agenda → publishing, in one deployment. See
[spec.md](spec.md) for the full product requirements and
[decisions.md](decisions.md) for the key technical decisions and their
rationale.

## What it does

- **Public CFP forms** — a form builder (`src/domain/forms.ts`) with
  short/long text, choice, file, and co-speaker fields, plus **basic
  conditional logic** (`showIf`, one field's visibility keyed on another's
  answer) — no arbitrary rules engine. Submissions stay editable by the
  submitter until the form closes.
- **Track-based review routing** — submissions pick tracks, reviewers own
  tracks (`src/domain/review.ts`), so each reviewer's queue is scoped
  automatically. No separate routing engine.
- **Review & decisions** — reviewers record a non-binding
  approve/maybe/deny recommendation; an admin records the binding decision,
  can request changes from a speaker mid-review, and attaches personal
  feedback to the accept/waitlist/decline email.
- **Automatic acceptance conversion** — accepting a submission creates the
  speaker record(s), an unscheduled session, and the event's standard
  onboarding tasks, with no manual re-entry (`planAcceptanceConversion` in
  `src/domain/review.ts`).
- **Speaker portal** — speakers see their submissions, acceptance state, and
  outstanding tasks, and complete them in place, including structured
  **form-type tasks** (e.g. a hotel or flight-reimbursement form), not just
  uploads and confirmations.
- **Agenda builder** — day/room drag-and-drop placement (`@dnd-kit`) with
  live conflict detection: **blocking** conflicts (a speaker or room
  double-booked — physically impossible) and **advisory** ones (two talks
  from the same track overlapping — a legitimate call an organizer might
  make) are visually distinct, and neither ever blocks a placement
  (`src/domain/scheduling.ts`).
- **Comms hub** — a per-speaker communication log, a manual composer with
  merge fields, per-event overrides of the built-in email templates, and
  **working calendar invites**: `.ics` attachments that Gmail/Outlook/iCal
  all accept, with a correctly incrementing `SEQUENCE` so a re-sent invite
  (e.g. after a room assignment) updates the speaker's existing calendar
  entry instead of duplicating it (`src/domain/comms.ts`, `src/lib/ics.ts`).
- **Reminder cron** — a Cloudflare cron trigger nudges speakers about
  outstanding tasks at most once every 3 days, and stops once the event has
  started (`runReminderJob`, wired in `custom-worker.ts`).
- **Public program pages** — `/p/<slug>` renders a speaker gallery and
  schedule; `/embed/<slug>` serves the same content chrome-less for
  iframing, with a copy-paste `<iframe>` snippet built into the public page
  itself.

## Stack

- **Framework:** Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- **UI:** shadcn/ui (`src/components/ui`, CSS-variables mode) — all colors
  come from the semantic token set in `src/app/globals.css`
- **Deployment:** Cloudflare Workers via the OpenNext adapter
  (`@opennextjs/cloudflare`) — D1 (binding `DB`), R2 (binding `FILES`), and a
  cron trigger for reminders (see `wrangler.jsonc`)
- **Data layer:** Drizzle ORM over D1/SQLite, behind a storage-agnostic
  repository layer (see [Architecture](#architecture) below)
- **Auth:** better-auth, magic-link plugin, Drizzle adapter — every role
  (organizer, reviewer, speaker) signs in with an email link, no passwords
- **Email:** SendGrid, with a dev stub sender that logs instead of sending
- **Forms/validation:** react-hook-form + Zod

## Architecture

Three layers, enforced by directory:

- `src/app/` — routes only: server components/actions, route handlers. Thin.
- `src/domain/` — pure TypeScript domain services (evaluation, scheduling,
  comms, onboarding). **No datastore imports.**
- `src/db/` — the data layer:
  - `src/db/entities.ts` — Zod schemas; the single source of truth for
    entity shapes used everywhere outside the adapter.
  - `src/db/schema.ts` — Drizzle table definitions for D1.
  - `src/db/repos/*.ts` — storage-agnostic repository **interfaces**, typed
    against `entities.ts` only.
  - `src/db/repos/d1/*.ts` — the Drizzle/D1-backed implementations. This is
    the only place allowed to import Drizzle or D1 types.
- `src/lib/` — better-auth config, email sender, small utilities.

Swapping the datastore means adding a sibling of `src/db/repos/d1/` with the
same interfaces implemented against the new store — no changes to
`src/app/` or `src/domain/`.

## Running locally

```bash
npm install                # also generates worker-configuration.d.ts (postinstall)
cp .env.example .dev.vars  # fill in BETTER_AUTH_SECRET at minimum
npm run seed               # reset local D1, apply migrations, load demo data
npm run dev                # http://localhost:3000
```

`npm run seed` is destructive by design: it deletes the local D1 state
(`.wrangler/state/v3/d1`), re-applies every migration, and writes a full demo
event — "AI Engineer Summit 2026" with 3 tracks, 4 rooms, a published call for
speakers, 15 submissions across all six statuses (draft, submitted, maybe,
approved, denied, withdrawn), 6 sessions from the accepted talks (3 placed on
the agenda, 3 in the unscheduled tray), the six canonical onboarding tasks — the
**hotel stay requirement** and **flight reimbursement** form-type tasks, plus
finalize talk description, finalize bio & photos, announce participation, and
invite colleagues with speaker discount — assigned to every speaking speaker
with completion left in a mixed state, and a handful of `email_log` rows. The
event's dates are always relative to when you seed (~45 days out), so
reminders still fire and the public program always reads as upcoming, never
archived. It seeds through the repository layer, so it also exercises every
D1 adapter. To apply migrations without wiping data, use
`npm run db:migrate:local`.

### Signing in

There are no passwords — every role signs in with a magic link
(see [decisions.md](decisions.md) D-007). In development there is no mail
provider, so each requested link is printed to the dev-server console **and**
appended to `.dev-magic-links.log` (gitignored):

```bash
# 1. open http://localhost:3000/login and request a link for one of:
#      admin@greenroom.dev      (admin  -> /admin)
#      dana@greenroom.dev       (reviewer -> /admin, no event settings)
#      priya.raman@example.com  (speaker -> /portal)
# 2. grab the newest link and open it
tail -n 1 .dev-magic-links.log | cut -f3
```

Signing in lands on `/dashboard`, which forwards to `/admin` or `/portal`
depending on the role. Anonymous requests to either area redirect to `/login`.

> The magic-link URL is built from `BETTER_AUTH_URL` in `.dev.vars`, so if you
> run the dev server on a port other than 3000, change that value to match or
> the links will point at the wrong origin.

## Testing

- **`npm run test`** — Vitest. Colocated `*.test.ts` files next to the pure
  logic they cover in `src/domain/` and `src/lib/` (conflict detection,
  template rendering, `.ics` generation, slug/validation rules, reminder
  cadence, …). No datastore or network involved. ~260 unit tests.
- **`npm run test:e2e`** — Playwright, specs in `e2e/` covering the
  acceptance path end to end (public CFP submission, review & accept, portal
  task completion, agenda placement + conflict detection, the public
  program). ~50 e2e tests. This command **seeds the local D1 database
  destructively** (same as `npm run seed`), temporarily swaps `.dev.vars` to
  run the dev server on port 3010, and restores the original `.dev.vars` via
  a global teardown once the run finishes. It needs the local database and
  the magic-link log to itself — never run it while another dev server (or
  another agent's) is up against the same local state.

Both are expected to pass before every commit, alongside `npm run typecheck`,
`npm run lint`, and `npm run build`.

## Scripts

| Script                    | What it does                                              |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`               | Next.js dev server (Turbopack)                             |
| `npm run build`             | Production Next.js build                                   |
| `npm run start`             | Serve a production `next build` locally                    |
| `npm run lint`              | ESLint                                                      |
| `npm run typecheck`         | `tsc --noEmit`                                              |
| `npm run test`              | Vitest unit tests (`src/domain/`, `src/lib/`)               |
| `npm run test:watch`        | Vitest in watch mode                                        |
| `npm run test:e2e`          | Playwright e2e tests (`e2e/`) — see [Testing](#testing)     |
| `npm run seed`              | Reset the local D1 database and load the demo event         |
| `npm run db:reset:local`    | Delete the local D1 state (`.wrangler/state/v3/d1`)         |
| `npm run db:generate`       | Generate a Drizzle migration from `src/db/schema.ts`        |
| `npm run db:migrate:local`  | Apply migrations to the local D1 database (`wrangler d1`)   |
| `npm run db:migrate:remote` | Apply migrations to the remote D1 database                  |
| `npm run cf-typegen`        | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `npm run preview`           | OpenNext build + local Workers preview                      |
| `npm run deploy`            | OpenNext build + deploy to Cloudflare Workers                |

## Deploying

1. `wrangler d1 create greenroom` and paste the returned `database_id` into
   `wrangler.jsonc`.
2. `wrangler r2 bucket create greenroom-files`.
3. `npm run db:migrate:remote`.
4. `wrangler secret put BETTER_AUTH_SECRET` (and `SENDGRID_API_KEY` once you
   have one).
5. `npm run deploy`.

The cron trigger in `wrangler.jsonc` (every 15 minutes) runs the deadline
reminder job (`src/domain/comms.ts`) via the `scheduled` handler in
`custom-worker.ts`, which wraps the OpenNext-generated fetch handler.

> In production, `EMAIL_FROM_ADDRESS` must be a
> [SendGrid-verified sender](https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification)
> — it's also used as the calendar invite's `ORGANIZER` (see `.env.example`),
> so RSVP replies and deliverability both depend on it. Unlike Resend,
> SendGrid has no shared sandbox sender: the default
> (`no-reply@greenroom.localhost`) only works with the dev transport, and
> production sends fail closed until a real sender is verified.

## Demo walkthrough

[walkthrough.md](walkthrough.md) is a guided demo script that follows the
acceptance path end to end — create/open the seeded event, submit via the
public CFP, review and accept, inspect the resulting speaker/session/tasks,
complete portal work, send a real email and calendar invite, place the
session on the agenda, trigger and resolve a conflict, and view the public
program.

The script can also record itself: `npx playwright test --config
playwright.demo.config.ts` drives the whole demo against the seeded test
harness (destructive to local dev data, like the e2e suite), and
`node scripts/assemble-walkthrough.mjs` stitches the per-act clips into
`walkthrough.mp4` with the narration as `walkthrough.srt` subtitles.

## Design notes

- [docs/airtable-sync.md](docs/airtable-sync.md) — architecture for the
  competition's Airtable-sync bonus. It's design-only, not implemented (see
  the doc for why), and describes the adapter shape and sync mechanics we'd
  build.

## License

MIT — see [LICENSE](LICENSE).
