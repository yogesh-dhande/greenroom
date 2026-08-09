# Deploying Greenroom

Greenroom deploys as a single Cloudflare Worker (Next.js via the OpenNext
adapter) backed by D1 (SQLite) and R2 (file uploads). The free Workers plan is
enough to run it. This walkthrough goes from a fresh clone to a live
deployment; every step that bit us during the first real deploy has its
gotcha noted inline.

## Prerequisites

- A Cloudflare account (free plan works — see the bundle-size note below).
- Node 20+ and npm.
- For real email (magic-link sign-in, speaker comms): a
  [SendGrid](https://sendgrid.com) account with a verified sender. Without it
  the app deploys fine but nobody can sign in, because sign-in links arrive
  by email.

## 1. Install and authenticate

```sh
npm install
npx wrangler login
```

> **Gotcha:** if `wrangler` later reports "Not logged in" even though login
> succeeded, check whether a bare `~/.wrangler` directory exists — other
> tooling can create it, and wrangler then prefers it over the real config in
> `~/Library/Preferences/.wrangler` (macOS). See docs/learnings.md for the
> symlink fix.

## 2. Create the database and bucket

```sh
npx wrangler d1 create greenroom
npx wrangler r2 bucket create greenroom-files
```

Paste the `database_id` that the first command prints into `wrangler.jsonc`
under `d1_databases`. The bucket name is already referenced there (both as
`FILES` for uploads and `NEXT_INC_CACHE_R2_BUCKET` for the ISR cache).

> **Gotcha:** if your account has never had a `workers.dev` subdomain,
> register one once in the Cloudflare dashboard (Workers & Pages → your
> subdomain). Without it, parts of the deploy tooling fail with opaque
> timeouts (Cloudflare error 10063 underneath).

## 3. Apply migrations

```sh
npm run db:migrate:remote
```

This runs every file in `migrations/` against the remote D1 database, in
order, and is safe to re-run — already-applied migrations are skipped.

## 4. Set secrets

Each value is set with `npx wrangler secret put <NAME>` (it prompts on
stdin — nothing lands in your shell history or the repo):

| Secret | Required | What it is |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | yes | Session/token signing key. Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | The canonical origin users visit, e.g. `https://events.example.com` — magic-link callbacks are built from it. |
| `APP_URL` | no | Origin used in links inside outgoing email; falls back to `BETTER_AUTH_URL`. |
| `SENDGRID_API_KEY` | for real email | SendGrid API key. Without it, no email (including sign-in links) can be delivered in production. |
| `EMAIL_FROM_ADDRESS` | for real email | Must be a [SendGrid-verified sender](https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification). Also becomes the `ORGANIZER` on calendar invites, so deliverability and RSVP replies both depend on it. |
| `EMAIL_FROM_NAME` | no | Display name on outgoing email. Defaults to "Greenroom". |
| `AIRTABLE_API_KEY` | for Airtable sync | Personal access token with `data.records:write` + `schema.bases:write` scoped to your base. |
| `AIRTABLE_BASE_ID` | for Airtable sync | The `appXXXXXXXXXXXXXX` id from your base's URL. With either Airtable value missing the sync no-ops with a log line — everything else works. |

See `.env.example` for the same list with local-development notes
(locally these go in a gitignored `.dev.vars` instead).

## 5. Choose your domain

`wrangler.jsonc` ships with a `routes` block pinning a custom domain
(`custom_domain: true`). Two options:

- **Custom domain** (recommended): change the `pattern` to a hostname in a
  zone on your Cloudflare account. The deploy provisions the DNS record and
  certificate automatically — nothing to do in the dashboard.
- **workers.dev**: delete the `routes` block and set
  `"workers_dev": true` instead; your app lives at
  `https://greenroom.<your-subdomain>.workers.dev`.

Either way, set `BETTER_AUTH_SECRET`'s companion `BETTER_AUTH_URL` to match
the origin you chose, or magic links will point at the wrong host.

## 6. Deploy

```sh
npm run deploy
```

This builds with OpenNext and deploys with wrangler, including the static
assets and the cron trigger (every 15 minutes — it runs the weekly task
digest, CFP draft reminders, and the Airtable sync from `custom-worker.ts`'s
`scheduled` handler).

> **Gotcha:** the free Workers plan rejects bundles over 3 MiB gzipped.
> `"minify": true` is already pinned in `wrangler.jsonc` to stay under it;
> if a dependency pushes you over, the $5/mo paid plan raises the cap to
> 10 MiB.

## 7. First sign-in and the first admin

Visit your deployment, request a magic link, and sign in. New accounts get
the `speaker` role, so your first account must be promoted by hand:

```sh
npx wrangler d1 execute DB --remote --command \
  "UPDATE users SET role='admin' WHERE email='you@example.com'"
```

Sign out and back in (or just reload) and `/admin` is yours. From there you
can create your event; further role management currently needs the same
one-liner (`role` is `admin`, `reviewer`, or `speaker`; reviewers also need
rows in `reviewer_tracks` — a team-management UI is planned).

## Verifying it works

- The public site renders at your origin.
- Sign-in: request a magic link, click it from your inbox.
- Cron: `npx wrangler tail greenroom --format pretty` and wait for a
  quarter-hour tick; you'll see the reminder job (and, if configured, an
  `airtable sync: …` summary line).

## Local development

```sh
npm install
npm run seed     # reset + migrate + demo data in local D1
npm run dev      # http://localhost:3000
```

No email is sent locally: magic links are printed to the dev-server console
(`>> MAGIC LINK for …`) and appended to `.dev-magic-links.log`; outgoing mail
is echoed and written to `.dev-emails/`. Don't run `npm run seed` while a dev
server is up — the running server wedges (see docs/learnings.md).
