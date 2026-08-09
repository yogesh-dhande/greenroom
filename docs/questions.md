# Open Questions

Things we're not sure about and should get clarification on before they harden into the wrong shape. Each entry: the question, why it matters, and the **working assumption** we build with until answered.

Workflow: when a question is answered, record the answer as a first-class entry in [decisions.md](decisions.md) (rationale: "clarified by owner/organizer") and delete it here. Don't let answered questions linger.

---

## For the owner

### Q4. Reminder cadence and cooldown
Task/deadline reminder emails run from a cron (W5b). How often should a speaker be nudged about the same overdue task — daily, every 3 days, weekly? At what point do reminders stop?
**Working assumption:** one reminder per task at most every 3 days, stopping after the task is done or the event starts; admins can always send a manual nudge.

### Q8. Form-level "abstracts vs sessions" type switch — worth building?
The walkthrough ([04:35]) shows a Sessionboard form setting choosing whether a form collects abstracts (proposals to review) or sessions (confirmed talks, e.g. sponsor slots). Greenroom covers the second job via admin direct session entry (spec §5), not as a public form type. Is a public form that creates confirmed sessions actually needed, or is admin entry enough for the job?
**Working assumption:** admin direct entry covers it; no form-type switch. Revisit only if judging shows a public "session intake" form being exercised.

## For the organizer

### Q6. What does "embeddable on an external website" minimally mean?
For the public speaker gallery and schedule (important tier): is an iframe snippet enough, or is a script-embed/web-component expected?
**Working assumption:** responsive public pages plus a copy-paste iframe snippet.

## Product defaults we chose without explicit guidance

Lower stakes — silently defaulted, listed so they can be challenged cheaply.

- **Hotel/flight form responses** land in the admin onboarding dashboard only; organizers are not emailed per response. (Challenge if organizers expect an inbox notification.)
- **Public schedule times** display in the event's timezone only — no viewer-local conversion.
- **Co-speakers** get full portal access to the shared submission and their own copies of onboarding tasks.
- **Declined submissions** remain visible to the submitter in the portal (with the decision), not hidden.
- **Per-form admin/notification recipients** (walkthrough [05:37]) skipped — the producer himself labels it "optional"; all event admins see all forms.
