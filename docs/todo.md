# Owner TODO — things only you can do

Maintained by Claude: updated whenever something new is needed from you or an item completes. Items at the top are blocking.

## Airtable sync (owner decision 2026-08-09: build against a real base)

- [ ] **Create an Airtable base** for the sync — an empty base is fine (Claude will create tables via the API), or point Claude at an existing base and it will adapt.
- [ ] **Create a personal access token** at airtable.com/create/tokens with scopes `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`, granted access to that base. Set it as a secret by typing here:
  `! npx wrangler secret put AIRTABLE_API_KEY`
  and paste the token at the prompt (never into chat).
- [ ] **Share the base ID** (the `appXXXXXXXXXXXXXX` segment of the base's URL) — not a secret, chat is fine.

## Evaluator prep (after the deploy is verified)

- [ ] **Save evaluator persona sessions.** The judging harness clone lives at `scratchpad/killmysaas-evals-repo`; its browser agent has no email inbox, so each persona's magic-link sign-in is done once by hand and the session saved. For each of `speaker`, `organizer`, `reviewer`:
  1. In the evals repo, run `npm run sbek -- auth --persona speaker` (repeat later for the other two personas).
  2. A real Chromium window opens at the deployed site. **Do the entire login inside that window**: enter the persona's email on the login page, request the magic link, then fetch the link from your inbox and paste it into *that window's* address bar. (Opening the link in your normal browser authenticates the wrong session.)
  3. Once the window shows you signed in, return to the terminal and press Enter. The session lands in `.auth/<host>.<persona>.json` — those files hold live cookies; treat them as secrets.
  4. Use plus-addressed emails you control so each persona is a distinct account — e.g. `email+sbek-speaker@gmail.com`, `…+sbek-organizer@…`, `…+sbek-reviewer@…` — and put the same three addresses under `personaEmails` in the repo's `evalconfig.json`. The organizer and reviewer personas must hold those roles in the app: Claude will pre-create the accounts with the right roles in the deployed database and confirm the exact emails here before you run this.
  5. Re-run the `auth` command for a persona whenever its saved session expires.
- [ ] **`ANTHROPIC_API_KEY` for the evaluator** — a real API key exported in the shell you run `npm run eval` from. The harness calls the Anthropic SDK directly, so a Claude Code/Max **subscription does not work** here (alternative: an `ant auth login` profile if you have one). ~$2–10 of usage per full run; defaults to `claude-opus-5` for both agent and judge. `npm run smoke` needs no key.
- [ ] **Competition submission** — organizer's form + repo link + deployed URL + walkthrough video, before **Wed Aug 12, 10 PM PT**.

## Open questions (answer when convenient — working assumptions in questions.md meanwhile)

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
