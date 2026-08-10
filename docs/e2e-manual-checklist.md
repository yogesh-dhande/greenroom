# Manual-checklist E2E coverage

Mapped against `killmysaas-evals/runs/2026-08-10T04-30-18/manual-checklist.md` on 2026-08-10.

| Item | Automated evidence | Status |
| --- | --- | --- |
| CFP-08 | `e2e/cfp.spec.ts` submits an isolated proposal and inspects both real dev-transport messages for recipient, event, and talk title. | E2E covered |
| CFP-14 | `e2e/review.spec.ts` accepts and declines separate submissions, checks the UI result, recipient, title, decision copy, organizer note, and emitted message. | E2E covered |
| ABS-07 | `e2e/rounds.spec.ts` enables blind review, proves the reviewer cannot see identity, then proves the organizer's results retain it. | E2E covered |
| ABS-09 | `e2e/rounds.spec.ts` reminds the outstanding reviewer and verifies the addressed reminder, round name, pending count, and queue link. | E2E covered |
| ABS-13 | `e2e/rounds.spec.ts` downloads and parses the CSV, including its criteria, scores, recommendation, status, and speaker fields. | E2E covered |
| ABS-14 | The product makes no AI-triage claim. | Not applicable |
| SPK-06 | `e2e/speaker-record.spec.ts` sends a portal invite and verifies its UI state, event, recipient, portal URL, and communication-log marker. | E2E covered |
| SPK-07 | `e2e/portal.spec.ts` proves list and direct-URL isolation between speakers; `e2e/speaker-record.spec.ts` covers the invite-to-portal path. | E2E covered |
| SPK-10 | `e2e/files.spec.ts` uploads/replaces a deliverable and verifies filename, speaker/uploader, task, version metadata, direct download bytes, and ZIP contents. | E2E covered |
| SPK-13 | `e2e/comms.spec.ts` sends a personalized message to two selected speakers, checks both emitted messages, and checks both log rows. | E2E covered |
| SPK-16 | `src/domain/comms.test.ts` exercises the scheduled reminder window, eligibility, due work, delivery, cooldown, and failure behavior. Playwright covers the same send path through the manual trigger, but does not invoke the Worker's scheduled handler. | Unit/integration covered; deployed cron wiring still operational |
| CNT-08 | `e2e/comms.spec.ts` triggers the task digest, verifies sent messages and saved wording, then proves the cooldown disables a duplicate run. | E2E covered |
| CNT-14 | `e2e/files.spec.ts` creates two current deliverables, selects only one, chooses session grouping, downloads the ZIP, and verifies the session folder, inclusion/exclusion, and latest-only version behavior. `src/domain/file-export.test.ts` covers speaker/session/flat layouts, duplicate names, sanitization, and grouping parsing. | E2E covered |
| EMB-11 | `e2e/program.spec.ts` proves local-storage persistence after reload and parses the personal `.ics`, including only starred sessions with room data. | E2E covered |
| EMB-15 | `e2e/embed-share.spec.ts` verifies the builder exposes all five widget types and all five output formats, generates configured output, fetches XML, and installs a configured script on a separate host document to prove widget, track, field, color, and custom-CSS choices. `src/domain/embed-config.test.ts` covers stateless parsing/output and field/filter transforms. | E2E + unit covered |
| EMB-16 | `e2e/core-gaps.spec.ts` edits an already-published session and verifies immediate propagation to the public schedule, installed embed, and iCal feed without republishing. `e2e/program.spec.ts` covers cross-surface field consistency. | E2E covered |
| CRM-11 | `e2e/crm.spec.ts` selects two contacts, sends personalized merge-field messages, verifies both recipients and resolved bodies, and relies on the same per-contact logging path checked in the isolated CRM lifecycle. | E2E covered |

The dev transport evidence verifies Greenroom's generated recipient, subject, body, and log behavior. It does not verify production SendGrid credentials or third-party inbox delivery; those are deployment checks rather than application-flow gaps.
