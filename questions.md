# Open Questions

Things we're not sure about and should get clarification on before they harden into the wrong shape. Each entry: the question, why it matters, and the **working assumption** we build with until answered.

Workflow: when a question is answered, record the answer as a first-class entry in [decisions.md](decisions.md) (rationale: "clarified by owner/organizer") and delete it here. Don't let answered questions linger.

---

## For the owner

### Q1. Deployment target + email sending credentials (blocks W6)
Which Cloudflare account should the app deploy to, under what domain/subdomain, and can you create a Resend API key (with a verified sending domain)? Real email delivery is a judged requirement (spec §7), and deliverability needs the sending domain's DNS records.
**Working assumption:** none — this is a hard blocker for the deploy wave (tracked as D-014). Everything else proceeds locally.

### Q2. Who records the walkthrough, and in what form?
The submission requires a walkthrough alongside the repo and deployed site. Is that a video you record, a written guided script we prepare for you, or both?
**Working assumption:** we prepare a written acceptance-path script (spec's demo walkthrough) plus a seeded demo environment; you record the video from it.

### Q3. Is the admin-only-decisions narrowing acceptable? (D-025)
Spec §4 says decisions are "decidable by reviewer or admin," but accepting now creates a session, onboarding tasks, and a speaker-facing email — so we made binding decisions admin-only, with reviewer votes as non-binding recommendations.
**Working assumption:** the narrowing stands. Flag if reviewers must be able to accept/decline directly.

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
