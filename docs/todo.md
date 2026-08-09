# Owner TODO — things only you can do

Maintained by Claude: updated whenever something new is needed from you or an item completes. Items at the top are blocking.

## Airtable sync (owner decision 2026-08-09: build against a real base)

- [ ] **(Optional, for local dev only)** add `AIRTABLE_API_KEY=…` to `.dev.vars` yourself in an editor — don't paste the token into chat or a terminal command. Not needed for the deployed sync (the secret is already set in the worker); it only lets a local dev server hit the base.

## Evaluator prep (after the deploy is verified)

- [ ] **`npm install` in the evals repo.** The judging harness now lives at `~/projects/killmysaas-evals` (moved out of the session temp dir); dependencies weren't copied, so run `npm install` there once.
- [ ] **Save evaluator persona sessions.** The harness's browser agent has no email inbox, so each persona's magic-link sign-in is done once by hand and the session saved. For each of `speaker`, `organizer`, `reviewer`:
  1. In `~/projects/killmysaas-evals`, run `npm run sbek -- auth --persona speaker` (repeat later for the other two personas).
  2. A real Chromium window opens at the deployed site. **Do the entire login inside that window**: enter the persona's email on the login page, request the magic link, then fetch the link from your inbox and paste it into *that window's* address bar. (Opening the link in your normal browser authenticates the wrong session.)
  3. Once the window shows you signed in, return to the terminal and press Enter. The session lands in `.auth/<host>.<persona>.json` — those files hold live cookies; treat them as secrets.
  4. Use plus-addressed emails you control so each persona is a distinct account — e.g. `email+sbek-speaker@gmail.com`, `…+sbek-organizer@…`, `…+sbek-reviewer@…` — and put the same three addresses under `personaEmails` in the repo's `evalconfig.json`. The organizer and reviewer personas must hold those roles in the app: Claude will pre-create the accounts with the right roles in the deployed database and confirm the exact emails here before you run this.
  5. Re-run the `auth` command for a persona whenever its saved session expires.
- [ ] **Run the evaluation** — the harness now supports your Claude Code subscription, no API key needed (ported 2026-08-09). After `npm install`, verify auth with `npm run probe:claude-code`, then run `SBEK_CLAUDE_CODE=1 npm run eval -- --url https://greenroom.usespaces.dev`. Caveats: subscription-mode scores are directional (judge runs under slightly different plumbing than the API-key path), so if you want "official"-style numbers and have an `ANTHROPIC_API_KEY`, the default path is unchanged and preferred. `npm run smoke` still needs no auth at all.
- [ ] **Competition submission** — organizer's form + repo link + deployed URL + walkthrough video, before **Wed Aug 12, 10 PM PT**.

## Open questions (answer when convenient — working assumptions in questions.md meanwhile)

- [ ] Q4: reminder cadence — recommend closing with the built default (one nudge per task every 3 days, stop at completion or event start). Say the word and it's recorded as a decision.
- [ ] Q8: public "session intake" form type — recommend closing as not-building; admin direct entry (now shipped in W9) covers the job.
- [ ] Q6: what does "embeddable" minimally mean — is an iframe snippet enough? (assumed: yes; a question for the organizer, not you.)

## Done

- [x] `npx wrangler login` (2026-08-09) — account verified, D1 database created in WNAM, remote migrations applied, worker created, `BETTER_AUTH_SECRET` set.
- [x] SendGrid chosen over Resend (D-030) — code migrated, `resend` dependency removed.
- [x] R2 enabled (2026-08-09) — bucket `greenroom-files` created with `wnam` location hint.
- [x] `SENDGRID_API_KEY` secret set (2026-08-09).
- [x] SendGrid domain authentication verified for `greenroom.usespaces.dev` (2026-08-09) — sender is `no-reply@greenroom.usespaces.dev` (`EMAIL_FROM_ADDRESS` set).
- [x] Domain chosen (2026-08-09): custom domain `greenroom.usespaces.dev` (initial "greenboard" was a typo; config and all URL secrets corrected). DNS: nothing needed from you — `usespaces.dev` is already a Cloudflare zone, so the deploy provisions the record and certificate itself.
- [x] Q5 answered (2026-08-09): build the Airtable sync against a real base — see top section for what it needs from you.
- [x] Q7 answered (2026-08-09): `.ics` calendar invites are good enough; D-020 stands, the organizer follow-up video is moot.
- [x] `AIRTABLE_API_KEY` secret set via wrangler (2026-08-09) — verified in the worker's secret list.
- [x] Airtable base ID shared (2026-08-09): `appXXXXXXXXXXXXXX` — recorded as `AIRTABLE_BASE_ID` in wrangler.jsonc; W10 sync build started.
