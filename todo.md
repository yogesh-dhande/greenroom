# Owner TODO — things only you can do

Maintained by Claude: updated whenever something new is needed from you or an item completes. Items at the top are blocking.

## Blocking the deploy (W6b)

Nothing — all owner-side blockers cleared 2026-08-09; deploy in progress.

## After the first deploy (evaluator prep)

- [ ] **Save evaluator persona sessions** — the judging harness (`sbek`) needs signed-in browser sessions: run its `auth --persona organizer|speaker|reviewer` flow against the deployed URL, completing the magic-link sign-in inside the browser window it opens (a link opened in your own browser authenticates the wrong session).
- [ ] **Provide `ANTHROPIC_API_KEY` to the evaluator** — only needed for `sbek run` (~$2–10 of API usage per full run per its README).
- [ ] **Competition submission** — organizer's form + repo link + deployed URL + walkthrough video, before **Wed Aug 12, 10 PM PT**.

## Open questions (answer when convenient — we build with the working assumptions in questions.md meanwhile)

- [ ] Q4: reminder cadence for overdue tasks (assumed: every 3 days, stop at event start).
- [ ] Q5: Airtable sync — build against a real base, or leave design-only? (assumed: design-only).
- [ ] Q7: did the organizer's follow-up video on email/calendar expectations ever appear?
- [ ] Q8: is a public "session intake" form type (vs admin direct entry) actually needed? (assumed: no).

## Done

- [x] `npx wrangler login` (2026-08-09) — account verified, D1 database created in WNAM, remote migrations applied, worker created, `BETTER_AUTH_SECRET` set.
- [x] SendGrid chosen over Resend (D-030) — code migrated, `resend` dependency removed.
- [x] R2 enabled (2026-08-09) — bucket `greenroom-files` created with `wnam` location hint.
- [x] `SENDGRID_API_KEY` secret set (2026-08-09).
- [x] SendGrid domain authentication verified for `greenroom.usespaces.dev` (2026-08-09) — sender is `no-reply@greenroom.usespaces.dev` (`EMAIL_FROM_ADDRESS` set).
- [x] Domain chosen (2026-08-09): custom domain `greenroom.usespaces.dev` (initial "greenboard" was a typo; config and all URL secrets corrected).
