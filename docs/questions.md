# Open Questions

Things we're not sure about and should get clarification on before they harden into the wrong shape. Each entry: the question, why it matters, and the **working assumption** we build with until answered.

Workflow: when a question is answered, record the answer as a first-class entry in [decisions.md](decisions.md) (rationale: "clarified by owner/organizer") and delete it here. Don't let answered questions linger.

---

**Q9 — How does the first admin get admin access on a fresh instance? (owner, asked 2026-08-09)**
The owner raised this while scoping the W12 team-management page. Today the bootstrap is accidental: the local seed creates an admin, and the deployed instance's admins were written into D1 by hand — a fresh self-hosted deployment has no path to its first admin at all. It matters because Greenroom is an open-source product others will deploy, and the team page is useless until someone can reach it. **Working assumption (recommended to owner, not yet confirmed):** an `ADMIN_EMAILS` env var/secret promotes matching accounts on sign-in; if it's unset and no admin exists yet, the first account to sign in becomes admin, and that rule switches off permanently once any admin exists.

*(Q4, Q6 and Q8 were closed 2026-08-09 by the owner's directive to match Sessionboard's documented behavior; see decisions.md D-039, D-040, D-041.)*

## Product defaults we chose without explicit guidance

Lower stakes — silently defaulted, listed so they can be challenged cheaply.

- **Hotel/flight form responses** land in the admin onboarding dashboard only; organizers are not emailed per response. (Challenge if organizers expect an inbox notification.)
- **Public schedule times** display in the event's timezone only — no viewer-local conversion.
- **Co-speakers** get full portal access to the shared submission and their own copies of onboarding tasks.
- **Declined submissions** remain visible to the submitter in the portal (with the decision), not hidden.
- **Per-form admin/notification recipients** (walkthrough [05:37]) skipped — the producer himself labels it "optional"; all event admins see all forms.
