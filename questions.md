# Open Questions

Things we're not sure about and should get clarification on before they harden into the wrong shape. Each entry: the question, why it matters, and the **working assumption** we build with until answered.

Workflow: when a question is answered, record the answer as a first-class entry in [decisions.md](decisions.md) (rationale: "clarified by owner/organizer") and delete it here. Don't let answered questions linger.

---

## For the owner

### Q1. Cloudflare account access + SendGrid sender identity (blocks W6b deploy)
Email provider is settled (SendGrid, D-030 — owner has the API key). Still needed: (a) Cloudflare account access — either run `wrangler login` in a session, or an API token (Workers Scripts:Edit + D1:Edit + R2:Edit) with the account ID; note R2 requires billing enabled on the account even at free-tier usage; (b) whether to use the free `*.workers.dev` subdomain or a custom domain (custom needs the zone on the account); (c) which email address is SendGrid-verified, for `EMAIL_FROM_ADDRESS`, plus the `SENDGRID_API_KEY` value at secret-set time.
**Working assumption:** none — hard blocker for the deploy wave. Everything else proceeds locally.

### Q4. Reminder cadence and cooldown
Task/deadline reminder emails run from a cron (W5b). How often should a speaker be nudged about the same overdue task — daily, every 3 days, weekly? At what point do reminders stop?
**Working assumption:** one reminder per task at most every 3 days, stopping after the task is done or the event starts; admins can always send a manual nudge.

## For the organizer

### Q5. Airtable sync — worth building, and against what base?
Listed as a competition bonus, but the expected tables/fields/source-of-truth were never specified. Building it blind risks a sync nobody can judge.
**Working assumption:** design-only (documented architecture, no implementation) unless the organizer supplies a concrete base schema or confirms the bonus is judged on a working sync.

### Q6. What does "embeddable on an external website" minimally mean?
For the public speaker gallery and schedule (important tier): is an iframe snippet enough, or is a script-embed/web-component expected?
**Working assumption:** responsive public pages plus a copy-paste iframe snippet.

### Q7. Follow-up video on email/calendar expectations
The organizer said they'd record a follow-up video showing email/invite expectations in more depth. If it changes anything about D-020's mechanics (attachment form, UTC times, update/cancel flow), we need it before the comms polish wave (W5b).
**Working assumption:** current D-020 behavior stands until the video says otherwise.

## Product defaults we chose without explicit guidance

Lower stakes — silently defaulted, listed so they can be challenged cheaply.

- **Hotel/flight form responses** land in the admin onboarding dashboard only; organizers are not emailed per response. (Challenge if organizers expect an inbox notification.)
- **Public schedule times** display in the event's timezone only — no viewer-local conversion.
- **Co-speakers** get full portal access to the shared submission and their own copies of onboarding tasks.
- **Declined submissions** remain visible to the submitter in the portal (with the decision), not hidden.
