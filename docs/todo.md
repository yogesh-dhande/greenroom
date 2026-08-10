# Owner TODO — things only you can do

Maintained by Claude: updated whenever something new is needed from you or an item completes. Items at the top are blocking.

## Airtable sync (owner decision 2026-08-09: build against a real base)

- [ ] **(Optional, for local dev only)** add `AIRTABLE_API_KEY=…` to `.dev.vars` yourself in an editor — don't paste the token into chat or a terminal command. Not needed for the deployed sync (the secret is already set in the worker); it only lets a local dev server hit the base.

## Blocking

- [ ] **Competition submission** — organizer's form + repo link + deployed URL + walkthrough video, before **Wed Aug 12, 10 PM PT**.
- [ ] **Re-authenticate evaluator personas when sessions expire** — for each of `speaker`/`organizer`/`reviewer`: run `npm run sbek -- auth --persona <name>` in `~/projects/killmysaas-evals` and complete the magic-link login entirely inside the Chromium window it opens (fetch the link from your inbox, paste into *that window's* address bar; your normal browser authenticates the wrong session). Sessions land in `.auth/` — live cookies, treat as secrets. Only needed on expiry; all three are currently valid.

## Done

- [x] Evaluator prep complete (2026-08-09): `npm install` in `~/projects/killmysaas-evals`, all three persona sessions saved (`+sbek-*` accounts hold their roles in the deployed DB; addresses live only in the gitignored `evalconfig.json`), and the eval runs under the Claude Code subscription (`SBEK_CLAUDE_CODE=1 npm run eval -- --url https://greenroom.usespaces.dev`) — four runs executed 2026-08-09.
- [x] Cloudflare Workers **paid plan** upgraded (2026-08-09) — removes both free-plan walls: the 10 ms CPU cap and the 3 MiB bundle cliff (now 10 MiB; `keep_names: false` in wrangler.jsonc can be revisited if ever needed). *Correction (2026-08-09, late):* the paid plan did **not** fully fix the authenticated-route hangs — `/admin` and `/portal` stalls recurred in eval runs 3 and 4 and in an external audit run, all post-upgrade. Root cause under active investigation; no owner action needed yet.
- [x] `npx wrangler login` (2026-08-09) — account verified, D1 database created in WNAM, remote migrations applied, worker created, `BETTER_AUTH_SECRET` set.
- [x] SendGrid chosen over Resend (D-030) — code migrated, `resend` dependency removed.
- [x] R2 enabled (2026-08-09) — bucket `greenroom-files` created with `wnam` location hint.
- [x] `SENDGRID_API_KEY` secret set (2026-08-09).
- [x] SendGrid domain authentication verified for `greenroom.usespaces.dev` (2026-08-09) — sender is `no-reply@greenroom.usespaces.dev` (`EMAIL_FROM_ADDRESS` set).
- [x] Domain chosen (2026-08-09): custom domain `greenroom.usespaces.dev` (initial "greenboard" was a typo; config and all URL secrets corrected). DNS: nothing needed from you — `usespaces.dev` is already a Cloudflare zone, so the deploy provisions the record and certificate itself.
- [x] Q5 answered (2026-08-09): build the Airtable sync against a real base — see top section for what it needs from you.
- [x] Q7 answered (2026-08-09): `.ics` calendar invites are good enough; D-020 stands, the organizer follow-up video is moot.
- [x] `AIRTABLE_API_KEY` secret set via wrangler (2026-08-09) — verified in the worker's secret list.
- [x] Airtable base ID shared (2026-08-09) — stored as the `AIRTABLE_BASE_ID` worker secret (not committed anywhere); W10 sync shipped and deployed.
- [x] Q4/Q6/Q8 closed (2026-08-09) — owner directive: match Sessionboard's documented behavior. Recorded as D-039 (weekly task digest), D-040 (JS embed + JSON/iCal feeds), D-041 (session-type forms); W11 builds the changes.
- [x] Q9 answered (2026-08-09) — first-admin bootstrap via `ADMIN_EMAILS` env var only, explicitly no first-sign-in fallback (D-043); W12 builds it. Nothing needed from you: the deployed instance already has its admins, so setting `ADMIN_EMAILS` there is optional.
