# Owner TODO — things only you can do

Maintained by Claude: updated whenever something new is needed from you or an item completes. Items at the top are blocking.

## Blocking the deploy (W6b)

- [ ] **Enable R2 on the Cloudflare account** — dash.cloudflare.com → R2 → click through the enable flow (asks for a payment method; our usage stays in the free tier). Bucket creation currently fails with error 10042. Tell Claude when done; the bucket gets created with a `wnam` location hint (D-033).
- [ ] **Set the SendGrid API key** — in a Claude Code session, type:
  `! npx wrangler secret put SENDGRID_API_KEY`
  and paste the key at the interactive prompt (it goes straight to Cloudflare; never paste the key into chat). The worker (`greenroom`) already exists, so this works now.
- [ ] **Tell Claude which sender address is verified in SendGrid** — it becomes `EMAIL_FROM_ADDRESS`. SendGrid has no sandbox sender: production email fails until the From address is a [verified sender](https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification). This address is also the calendar-invite ORGANIZER.
- [ ] **Domain choice (default: workers.dev)** — the app will deploy to `greenroom.<your-subdomain>.workers.dev`. If you want a custom domain instead, the zone must be on this Cloudflare account; say so before first deploy. Silence = workers.dev.

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
