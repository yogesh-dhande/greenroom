# Greenroom

Open-source speaker & event content management platform — an alternative to
Sessionboard. Call-for-proposals → evaluation → acceptance → onboarding →
agenda → publishing, in one deployment. See [spec.md](spec.md) for the full
product requirements and [decisions.md](decisions.md) for the key technical
decisions and their rationale.

## Stack

- **Framework:** Next.js (App Router) + TypeScript (strict) + Tailwind CSS
- **Deployment:** Cloudflare Workers via the OpenNext adapter
  (`@opennextjs/cloudflare`) — D1 (binding `DB`), R2 (binding `FILES`), and a
  cron trigger for reminders (see `wrangler.jsonc`)
- **Data layer:** Drizzle ORM over D1/SQLite, behind a storage-agnostic
  repository layer (see [Architecture](#architecture) below)
- **Auth:** better-auth, magic-link plugin, Drizzle adapter — every role
  (organizer, reviewer, speaker) signs in with an email link, no passwords
- **Email:** Resend, with a dev stub sender that logs instead of sending
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

## Getting started

```bash
npm install                # also generates worker-configuration.d.ts (postinstall)
cp .env.example .dev.vars  # fill in BETTER_AUTH_SECRET at minimum
npm run db:migrate:local   # apply migrations to the local D1 database
npm run dev                # http://localhost:3000
```

## Scripts

| Script                    | What it does                                              |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`               | Next.js dev server (Turbopack)                             |
| `npm run build`             | Production Next.js build                                   |
| `npm run lint`              | ESLint                                                      |
| `npm run typecheck`         | `tsc --noEmit`                                              |
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
4. `wrangler secret put BETTER_AUTH_SECRET` (and `RESEND_API_KEY` once you
   have one).
5. `npm run deploy`.

The cron trigger in `wrangler.jsonc` (every 15 minutes) runs the deadline
reminder job (`src/domain/comms.ts`) via the `scheduled` handler in
`custom-worker.ts`, which wraps the OpenNext-generated fetch handler.
