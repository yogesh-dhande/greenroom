# Owner TODO — things only you can do

Maintained by Claude: updated whenever something new is needed from you or an item completes. Items at the top are blocking.

## Airtable sync (owner decision 2026-08-09: build against a real base)

- [ ] **(Optional, for local dev only)** add `AIRTABLE_API_KEY=…` to `.dev.vars` yourself in an editor — don't paste the token into chat or a terminal command. Not needed for the deployed sync (the secret is already set in the worker); it only lets a local dev server hit the base.

## Blocking

- [ ] **Disable temporary evaluation access after judging** — delete the production `EVALUATION_ACCESS_EXPIRES_AT` Worker secret (or let the configured date pass). This blocks new automatic persona sign-ins; revoke active demo sessions too if access must end before their normal expiry.
- [ ] **Competition submission** — organizer's form + repo link + deployed URL + walkthrough video, before **Wed Aug 12, 10 PM PT**.
- [ ] **(Optional) Inline video player in the GitHub README** — GitHub only renders an inline player for videos uploaded through its web UI, so the README currently uses a poster image that links to the landing-page player. For an inline player: edit README.md in the GitHub web editor, drag `public/demo.mp4` into the demo section, and it inserts a `user-images.githubusercontent.com` URL that renders as a player.
- [ ] **Run 8 manual checklist** — 19 items in `~/projects/killmysaas-evals/runs/2026-08-11T11-46-40/manual-checklist.md`. This is the newest checklist and supersedes the run-7 copy. Same timing trap as before: the SPK weekly-digest item only observably fires **Mondays 07:00–07:15 UTC** (D-039 schedule + 6-day cooldown) — check it in that window or it will look broken when it isn't.
- [ ] **Re-authenticate evaluator personas when sessions expire** — for each of `speaker`/`organizer`/`reviewer`: run `npm run sbek -- auth --persona <name>` in `~/projects/killmysaas-evals` and complete the magic-link login entirely inside the Chromium window it opens (fetch the link from your inbox, paste into *that window's* address bar; your normal browser authenticates the wrong session). Sessions land in `.auth/` — live cookies, treat as secrets. Only needed on expiry; all three are currently valid.

## API & MCP rollout

- [ ] **Create the walkthrough API key after deployment** — while signed in as an active admin, create a 30-day Read & write `gr_` key restricted to the demo event, save the one-time secret directly in a password manager, and revoke it after the walkthrough. Never paste it into chat, source control, screenshots, or recorded terminal history.
- [ ] **Authorize the walkthrough MCP client and add the connection step to the demo** — complete the interactive magic-link/admin-consent flow yourself, then demonstrate one read and one bounded write through the remote server without exposing the bearer token or refresh token in the recording.

## Done

- [x] **Run 8 complete (2026-08-11 14:23 UTC): overall 95.5%** (97.6% coverage) — the new best, up from run 7's 93.0%. Areas: CFP 93.1, ABS 96.4, SPK 96.7, CNT 96.8, AIA 100, EMB 92.9, CRM 97.4. SPK-S1 reached the evaluator's 120-turn cap; every other scenario completed. The run contained 23 28–33s full-navigation gaps across 17 incident episodes and used 18 same-code recovery deploys. The deduplicated product/test/deployment triage is in `docs/eval-gap-report.md`; no further evaluator run should start while selected fixes remain pending.
- [x] **Production Airtable PAT record-read scope verified (2026-08-11)** — D-090's first deployed full cron completed with 42 current rows updated, 110 stale managed rows deleted, and 0 failures, proving the existing Worker secret already has `data.records:read`; no token replacement was needed.
- [x] **Run 7 complete (2026-08-11 02:56 UTC): overall 93.0%** (98.1% coverage) — up from run 6's 91.3%, below run 5's 93.9% best. Areas: CFP 91.9, ABS 94.6, SPK 96.9, CNT 89.7, AIA 100, EMB 88.6, CRM 97.4. Recurring authenticated-route stalls required same-code recovery redeploys; SPK-S1 and CNT-S3 reached the 120-turn cap. Live calendar-invite sends failed with SendGrid 400 because the attachment `type` contained MIME parameters; public itinerary `.ics` downloads still worked.
- [x] **Run 5 complete (2026-08-10 06:26 UTC): overall 93.9%** (99% coverage) — up from 88.5. Areas: CFP 89.4, ABS 96.4, SPK 98.4, CNT 91.9, AIA 100, EMB 91.2, **CRM 92.1 (was 34.2 — W28 delivered)**. Score history: 68.4 → 72.0 → 81.8 → 88.5 → 93.9. Mid-run: authed-route stalls escalated (worker-side hanging promises, ~10ms CPU vs 60–210s wall, eventually touched eval traffic twice) — remediated live with a same-code redeploy at 06:10 UTC and by stopping the synthetic probe bursts; zero stalls after. Fix wave W29 triaged from the defect list.
- [x] Both run-5 gates decided (2026-08-09): a **one-time** evaluator DB reset approved — wipe all content but preserve the `+sbek-*` accounts, their roles, and their live auth sessions plus owner/admin accounts; Claude scripts and runs it before the eval; never reseed remote with demo data — and run 5 itself approved to launch once W28 (Speaker CRM, D-077) is deployed and verified, with the stall probe + `wrangler tail` capturing alongside.
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
