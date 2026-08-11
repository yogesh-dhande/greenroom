# Deploying Greenroom

Greenroom deploys as a single Cloudflare Worker (Next.js via the OpenNext
adapter) backed by D1 (SQLite) and R2 (file uploads). This walkthrough goes
from a fresh clone to a live deployment; every step that bit us during the
first real deploy has its gotcha noted inline. It also includes a shorter
routine redeploy checklist for an existing installation.

## Prerequisites

- A Cloudflare account on the
  [Workers Paid plan](https://developers.cloudflare.com/workers/platform/limits/).
  The current Worker is about 3.75 MiB compressed, above the free plan's 3 MiB
  upload limit, and the configured 30-second CPU limit also assumes the paid
  plan.
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
| `ADMIN_EMAILS` | no | Comma-separated addresses promoted to admin whenever they sign in (D-043) — the hands-off way to get your first admin. Case-insensitive. Without it, promote by hand as in §7. |
| `SENDGRID_API_KEY` | for real email | SendGrid API key. Without it, no email (including sign-in links) can be delivered in production. |
| `EMAIL_FROM_ADDRESS` | for real email | Must be a [SendGrid-verified sender](https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification). Also becomes the `ORGANIZER` on calendar invites, so deliverability and RSVP replies both depend on it. |
| `EMAIL_FROM_NAME` | no | Display name on outgoing email. Defaults to "Greenroom". |
| `AIRTABLE_API_KEY` | for Airtable sync | Personal access token with `data.records:write` + `schema.bases:read` + `schema.bases:write` scoped to your base. |
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

> **Gotcha:** the free Workers plan rejects bundles over 3 MiB gzipped. The
> current bundle is larger than that even with `"minify": true` and
> `"keep_names": false`, so a paid Workers plan is required. Wrangler prints
> the exact raw and compressed sizes as `Total Upload` during every deploy.

The OpenNext build may print `Using secrets defined in .dev.vars` and may
also warn that email is not configured while it prerenders pages locally.
Those messages describe the build process, not the secrets already attached
to the deployed Worker. Confirm the live secret names after deployment with
`npx wrangler secret list`; the command never prints their values.

## Routine redeploy of an existing installation

Do not recreate bindings, re-enter secrets, or reset data for an ordinary
redeploy. From the revision you intend to publish:

```sh
git status --short --branch
npm run test
npm run typecheck
npm run lint
# Run this only when the revision adds unapplied migrations:
npm run db:migrate:remote
npm run deploy
npx wrangler deployments list --name greenroom
```

`npm run deploy` includes the production Next.js/OpenNext build. Run the local
Playwright suite as an additional release gate when the change affects a key
product flow; it destructively resets only the local D1 database and must not
share that local state with a running dev server.

Never run a seed or reset command against the production D1 database during a
redeploy. The live instance contains real accounts, evaluator sessions, and
user-created event data. Apply committed migrations in order and let D1/R2,
Worker secrets, and custom-domain bindings survive the code replacement.

After deployment, use a real event slug to exercise public and authenticated
routes (the auth directory is optional; without it the probe still checks the
public and signed-out paths):

```sh
node scripts/smoke-deployed.mjs --once --event <event-slug> \
  --auth-dir <path-to-playwright-storage-states>
```

A successful deploy prints the new Worker version ID. Keep that ID with any
evaluation or incident notes so results can be tied to the exact deployment.
For a first deployment, continue with the initial-admin setup below.

### Known Worker request-path stalls

We have seen rare production requests spend 45–210 seconds in wall time while
using only 6–77 ms of Worker CPU, throwing no exception, and eventually ending
as `outcome=canceled`. Same-second authenticated D1 reads completed normally,
and cookieless requests could also stall, so this signature is a hanging
request-path promise rather than database latency or CPU exhaustion.

The demonstrated mechanism is OpenNext 1.20.2's generated default dispatcher:
it dynamically imports the generated Next handler inside every request, which
can expose a module-loader promise owned by one request context to a sibling.
Affected isolates then appear to remain poisoned. The original D-082 fix
preloaded the handler but continued to call that dispatcher; Wrangler's actual
minified bundle still contained its reachable dynamic-import branch. The
deployed preload-only version then reproduced the signature on `/`: 50,081 ms
wall, 23 ms CPU, `outcome=canceled`, no exception, with two active requests in
that isolate while a sibling isolate returned 200.

Greenroom's custom entry now preserves OpenNext's request-context, skew,
image, and middleware routing locally and statically calls the generated Next
handler. `npm run deploy` now runs `npm run check:worker-bundle` between the
OpenNext build and upload; the check creates a temporary Wrangler dry run and
verifies its source map contains those routing pieces but not
`.open-next/worker.js`.
A same-code redeploy replaces poisoned isolates and has restored service
immediately without changing D1 or R2, but that recovery can be temporary if
the deployed bundle still contains the trigger. A sustained deployed soak is
therefore required before considering the structural fix validated.

For routine confidence, run the one-round probe above. Before a long evaluator
run, use a sustained matrix instead:

```sh
node scripts/smoke-deployed.mjs --minutes 30 --event <event-slug> \
  --auth-dir <path-to-playwright-storage-states>
```

If stalls recur, capture `wrangler tail` output and the probe JSONL before
redeploying whenever service impact allows. Preserve both sides of the join:
the Worker's lifecycle fields (instance id, sequence, active requests, and a
start with no finish) and Cloudflare's terminal wall time, CPU time, outcome,
route, and Worker version. A browser's 30-second navigation timeout is not the
request's terminal outcome: the Worker can remain active and be canceled much
later. Then redeploy to restore service; do not reset or reseed production data.

## 7. First sign-in and the first admin

New accounts get the `speaker` role, so something has to grant the first
admin. There are two ways, and only one of them is automatic (D-043):

**With `ADMIN_EMAILS` (recommended).** Set it in §4:

```sh
npx wrangler secret put ADMIN_EMAILS   # e.g. you@example.com,cofounder@example.com
```

Then visit your deployment, request a magic link, and sign in — every
address on that list is promoted to admin as it signs in, existing accounts
included. The check runs on every sign-in, so removing someone from the
list doesn't demote them (do that from Team), and re-adding them restores
admin the next time they sign in.

**By hand.** If you'd rather not set the variable, sign in first and then
promote the row:

```sh
npx wrangler d1 execute DB --remote --command \
  "UPDATE users SET role='admin' WHERE email='you@example.com'"
```

Reload and `/admin` is yours. There is deliberately no "first account to
sign in becomes admin" fallback — on a public URL that's a race anyone can
enter.

From there, create your event and manage everyone else from **Team**
(`/admin/<event>/team`): promote to admin or reviewer, remove access, tick
which tracks each reviewer's queue is drawn from, and add someone by email
whether or not they already have an account. Adding a teammate sends an
invitation through the configured email sender and records it in the
communications log; the roster can resend a fresh sign-in link and show a
handover URL if delivery is in doubt. The one thing Team refuses is removing
the last admin, so an instance can't be locked out of itself.

## Verifying it works

- The public site renders at your origin.
- Sign-in: request a magic link, click it from your inbox.
- Authenticated organizer and speaker routes render without a 5xx or timeout;
  the routine-redeploy probe above checks these when storage states are given.
- `npx wrangler deployments list --name greenroom` shows the version ID that
  `npm run deploy` printed.
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
