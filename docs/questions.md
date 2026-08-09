# Open Questions

Things we're not sure about and should get clarification on before they harden into the wrong shape. Each entry: the question, why it matters, and the **working assumption** we build with until answered.

Workflow: when a question is answered, record the answer as a first-class entry in [decisions.md](decisions.md) (rationale: "clarified by owner/organizer") and delete it here. Don't let answered questions linger.

---

**Q10 — Is blind/anonymous review in scope?** The evaluator rubric (ABS-07) grades an anonymization option for review rounds — Sessionboard offers blind review — but neither spec.md nor any decision has ever mentioned it; the omission is inherited, not chosen. Why it matters: reviewers currently see full author identity (name, email, bio, company) on every review surface, and a rubric item will keep scoring it as a gap. **Working assumption:** out of scope before the Wednesday deadline — it touches every review surface plus the scorecard flow, and the remaining time goes to the eval-verified fixes (D-045/D-046 wave). If you want it, a minimal version would be a per-round "hide speaker identity" toggle affecting only the round scorecard view.

*(Q4, Q6 and Q8 were closed 2026-08-09 by the owner's directive to match Sessionboard's documented behavior — see decisions.md D-039, D-040, D-041; Q9 was answered by the owner 2026-08-09 — see D-043.)*

## Product defaults we chose without explicit guidance

Lower stakes — silently defaulted, listed so they can be challenged cheaply.

- **Hotel/flight form responses** land in the admin onboarding dashboard only; organizers are not emailed per response. (Challenge if organizers expect an inbox notification.)
- **Public schedule times** display in the event's timezone only — no viewer-local conversion.
- **Co-speakers** get full portal access to the shared submission and their own copies of onboarding tasks.
- **Declined submissions** remain visible to the submitter in the portal (with the decision), not hidden.
- **Per-form admin/notification recipients** (walkthrough [05:37]) skipped — the producer himself labels it "optional"; all event admins see all forms.
