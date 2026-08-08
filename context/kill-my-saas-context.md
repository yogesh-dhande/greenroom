# Kill My SaaS: Consolidated Sessionboard Replacement Context

Last updated: August 8, 2026

This document consolidates the competition brief, walkthrough video, Sessionboard reference material, and organizer clarifications shared in Discord. It is a living record of what the customer wants and what the competition requires. It is intentionally not an implementation plan.

Where sources differ, newer direct organizer clarifications take precedence over the original brief and walkthrough.

## Source material

- [Competition brief](https://docs.google.com/document/d/1rBHJtiNKHv4i43tdf2Rm0sDEYuIcajhmAPoBKR_Az-A/edit?tab=t.0)
- [Walkthrough and requirements video](https://www.youtube.com/watch?v=vUuK4Knl7oc)
- [Sessionboard](https://www.sessionboard.com/)
- [Sessionboard API introduction](https://sessionboard.mintlify.app/introduction)
- Kill My SaaS Discord announcements, questions, and organizer replies

Project-local source notes are under `context/`. Large exports, screenshots, transcripts, and raw Discord material are kept separately under the gitignored `.context-private/` directory.

## Executive summary

The customer currently pays more than $40,000 per year for Sessionboard. They do not need most of the platform. They primarily need the event-program workflow that takes an event from an open call for speakers to an accepted, scheduled, and properly onboarded speaker lineup.

The product should let an event team:

1. Configure an event.
2. Publish one or more speaker-submission forms.
3. Collect talks, speaker details, and supporting material.
4. Route submissions and reviewers by track.
5. Review and decide on submissions.
6. Convert accepted submissions into speakers, sessions, and onboarding tasks.
7. Communicate with speakers through working email and calendar invitations.
8. Track missing information and incomplete tasks.
9. Build an agenda with rooms, tracks, and conflict detection.
10. Publish or embed the resulting schedule and speaker information.

The goal is not a pixel-perfect Sessionboard clone. The goal is a fast, credible, open-source product that performs the job the customer actually needs.

## Why this product exists

- Sessionboard costs this customer more than $40,000 annually.
- The organizer describes the broader category as ranging from hundreds to hundreds of thousands of dollars per year or event.
- The customer uses mainly the Program side of Sessionboard, not its broader CRM, marketing, content-repurposing, or CMS offering.
- Sessionboard felt noticeably slow during the walkthrough. Responsiveness is an explicit opportunity to outperform it.
- The customer wants an open-source system they can keep, understand, and continue improving instead of remaining dependent on a closed enterprise SaaS vendor.

## Users

### Event administrator

The primary user is a nontechnical event-production professional. Administrators configure events and forms, monitor submissions, coordinate reviewers, accept speakers, chase missing assets, communicate decisions, and build the agenda.

The admin experience is the product priority. The organizer expects to put the product directly in front of real event professionals and have them use it during evaluation.

### Speaker or submitter

A speaker submits a proposed talk, supplies personal and session information, sees whether the proposal was accepted, updates their biography and headshot, completes assigned forms or file requests, and receives emails and calendar invitations.

A submission can involve more than one speaker, but requiring a minimum of two speakers was specifically identified as undesirable in the walkthrough.

### Reviewer

A reviewer evaluates submissions for one or more assigned tracks. The minimum decision workflow is deliberately small: `unreviewed -> approve / maybe / deny`.

### Public attendee

An attendee may view a mobile-friendly speaker gallery or public agenda embedded on the event website. Attendee registration and ticketing are outside the main scope.

## Core domain concepts

| Concept | Meaning in this product |
| --- | --- |
| Event | The conference or program being managed, including dates, basic details, tracks, and rooms. |
| Submission form | A configurable public call-for-speakers form. An event can have multiple forms. |
| Submission or abstract | A proposed talk that has not necessarily been accepted. |
| Speaker or participant | A person attached to a submission or confirmed session. |
| Track | A category selected on a submission and used to assign relevant reviewers and organize the agenda. |
| Reviewer | A committee member responsible for submissions in one or more tracks. |
| Review or decision | An evaluation of a submission. The minimum statuses are unreviewed, approve, maybe, and deny. |
| Session | A confirmed agenda item. It may come from an accepted submission or be entered directly for a guaranteed speaker, such as a sponsor. |
| Task | A speaker-onboarding action such as completing a form, uploading a file, or confirming information. |
| Room | A physical agenda location used for scheduling and conflict detection. |
| Agenda | The scheduled collection of accepted sessions across days, rooms, and tracks. |

## End-to-end workflow

### 1. Configure the event

An administrator creates an event and enters its basic identity, dates, settings, tracks, and rooms. The Sessionboard screenshots include a broader configuration area, but only the data necessary to support submission, onboarding, and scheduling workflows is essential.

### 2. Build the call-for-speakers form

The administrator creates one or more public submission forms. A form can include:

- A welcome screen and explanatory copy.
- Talk title, description, and other abstract information.
- One or more track choices.
- Speaker and co-speaker information.
- Biography, headshot, and supporting-file fields.
- Required fields and ordinary validation.
- Basic conditional logic.
- Submission opening and closing behavior.
- A confirmation page and confirmation email.

Basic conditional logic is sufficient for the MVP. A sophisticated arbitrary rules engine is not required.

The source material also shows or mentions submission limits, draft submissions, reminder emails, cross-field character limits, administrator access, and multilingual forms. English-only is sufficient. Payments and fees are not needed.

### 3. Submit and edit a proposal

The public CFP page allows a speaker to submit a talk without access to the admin application. The form must enforce required fields and produce a working post-submission confirmation.

Submitters can edit their submissions afterward. Some products allow administrators to lock editing at a specified time, but this customer does not actively use that feature, so it is optional.

### 4. Route and review submissions

Submissions select one or more tracks. Reviewers also review one or more tracks, which provides the required category-routing behavior without a complex routing engine.

The minimum workflow is:

1. A submission begins as unreviewed.
2. An assigned reviewer examines it.
3. The reviewer or administrator marks it approve, maybe, or deny.
4. The event team communicates the decision.

The original brief mentions scoring, multiple review rounds, and optional AI assistance. Those remain useful enhancements, but the later organizer clarification establishes that the simple status workflow is enough for the MVP.

A bonus feature would let administrators email the speaker from inside the review flow to request changes or attach feedback to the approval or denial message.

### 5. Accept a submission

Accepting an abstract should automatically create or confirm:

- The speaker record or records.
- The session record.
- The appropriate onboarding tasks.

This conversion should not require administrators to re-enter the accepted proposal manually.

Direct session entry should also be possible for people already guaranteed a place in the program, such as sponsor speakers.

### 6. Onboard the speaker

The speaker portal shows the speaker's submissions or sessions, acceptance state, profile, and incomplete tasks. Speakers should be able to maintain their own biography and other profile information.

Organizer-provided task examples include:

- Complete a hotel-stay requirements form.
- Complete a flight-reimbursement form.
- Finalize the talk description.
- Finalize the speaker biography and photos.
- Announce participation.
- Invite colleagues using a speaker discount.
- Upload presentation slides or other supporting files.

Sessionboard separates tasks, forms, file requests, resources, and files. The replacement does not necessarily need identical navigation, but it needs to cover the underlying jobs.

Administrators need a clear view of which accepted speakers still have missing biographies, headshots, forms, files, or other incomplete onboarding work.

### 7. Communicate with speakers

Email and calendar delivery must actually work at an MVP level. Stubs or interface-only demonstrations are not sufficient.

The expected communication capabilities include:

- Submission confirmation.
- Acceptance and denial messages.
- Requests for changes or missing information.
- Task and deadline reminders.
- Calendar invitations compatible with Gmail, Outlook, and iCal clients.

Cloudflare email tooling and Resend were mentioned as practical implementation options, not mandatory providers.

Calendar invitations do not need video-meeting links. Room details should be included when known. The normal workflow may send an initial invitation without a room and update it after room assignments are finalized.

### 8. Build the agenda

Accepted sessions become schedulable agenda items. For the MVP, the organizer confirmed that the following is enough:

- Day-based scheduling.
- Room assignment.
- Drag-and-drop placement.
- Conflict detection.

The original brief also requests list, day, week, track, and room views. Those additional views are valuable, but the later clarification narrows the minimum requirement to day/room scheduling with drag-and-drop and conflict detection.

Likely conflicts include:

- A speaker assigned to two simultaneous sessions.
- A room assigned to two simultaneous sessions.
- Potential track or resource conflicts where applicable.

### 9. Publish the program

The source material asks for mobile-friendly public speaker and schedule experiences that can be embedded on an external website.

There is an important scope distinction:

- A usable public CFP page and public schedule/speaker output support the core workflow.
- Recreating Sessionboard's broader CMS and generalized embed-management system is explicitly optional.

### 10. Synchronize with Airtable

Airtable is part of the customer's existing operating environment and earns competition bonus consideration.

The organizer does not require sophisticated two-way synchronization. The clarified expectation is:

- App-created records can land in Airtable so existing new-row automations run.
- The application can periodically or on page load read Airtable-side changes.
- A complex real-time synchronization system is unnecessary for the MVP.

The exact table schema, authentication model, and source-of-truth boundaries have not yet been supplied.

## Requirement priority

### Required for a credible MVP

- Fast, usable administrator interface designed for nontechnical event professionals.
- Basic event configuration.
- Multiple configurable submission forms.
- Basic conditional form logic.
- One or more track selections per submission.
- Public speaker-submission flow.
- Editable submissions.
- Working confirmation page.
- Working submitter confirmation email.
- Abstract/submission list for administrators.
- Track-based reviewer responsibility.
- `unreviewed -> approve / maybe / deny` review flow.
- Acceptance automatically creates the speaker, session, and onboarding tasks.
- Speaker portal with editable profile information.
- Biography and headshot collection.
- Forms, file requests, or equivalent onboarding tasks.
- Administrator visibility into outstanding speaker tasks.
- Working email delivery.
- Working calendar invitations.
- Day and room agenda scheduling.
- Drag-and-drop scheduling.
- Speaker and room conflict detection.

### Important or strongly desired

- Submission close dates and reminders.
- Draft or incomplete submission handling.
- Templated communications.
- Supporting-document and slide uploads.
- Public/mobile speaker gallery.
- Public/mobile schedule.
- Website embedding for speakers and schedules.
- Airtable-backed persistence or practical Airtable synchronization.
- Clear filters, sorting, columns, and statuses in the submission view.
- Portal resource or wiki pages for speaker guidance.
- HTML embeds for existing reference material.

### Useful enhancements

- Scored reviews and rating fields.
- Multiple evaluation rounds.
- In-app requests for submission changes.
- Feedback attached to accept/deny decisions.
- Configurable edit-lock deadlines.
- Administrator notification customization.
- Additional agenda views by week, track, or room.
- Dashboard widgets and reporting.
- Saved table views and configurable columns.
- Generalized CMS/embed tooling.
- API coverage beyond what the main UI needs.
- A small useful agentic feature.

### Explicitly optional or out of scope

- Payment collection.
- Accelevents integration. The original brief requested it, but the organizer later said it can be skipped and is not required.
- Full CRM functionality.
- Marketing campaign functionality.
- Content transcription and repurposing.
- Full Sessionboard CMS recreation.
- AI-assisted evaluation.
- A large agentic system. The admin UI is the priority.
- Multilingual forms; English is enough.
- Video-meeting links in calendar invitations.
- Exact Sessionboard visual fidelity.

## Screen and interaction references

The competition brief contains 37 exported pages and 40 original screenshots covering the following areas.

### Event configuration

- Basic event setup and event settings.
- Program configuration entry points.

### Submission-form builder

- Submission type and participants.
- Welcome-screen content.
- Abstract-information fields.
- Participant-information fields.
- Payments and fees, annotated as not needed.
- Form settings and close date, annotated as important.
- Post-submission confirmation page, annotated as something that must work.
- Submitter confirmation email, annotated as a must-have.
- Administrator notifications, annotated as nice to have.

### Public CFP and speaker portal

- Public call-for-speakers page.
- Submitted session and attached speakers.
- Acceptance or submission state.
- Speaker biography and profile editing.
- Speaker tasks and forms.

### Abstract management

- Status tabs such as all, accepted, pending, queue, declined, withdrawn, and drafts.
- Search, sorting, filtering, saved views, and configurable columns.
- Session fields such as track, tags, speakers, files, location, description, and review ratings.

These screenshots demonstrate the expected density and breadth of an admin table, but not every Sessionboard column is required.

### Agenda

- List, day, week, month, room, and conflict views.
- Session search, filters, drafts, columns, and add-session controls.
- Session placement and room assignment.

### Portals and onboarding

- Task creation.
- Form creation for contacts, groups, or submissions.
- File-request creation and instructions.
- Resource pages and files.

### Embeds and dashboards

- Embed creation and generated embed code, marked optional.
- Submission, participant, evaluation, agenda, and program-health dashboards, marked optional or best effort.

## Product principles inferred from the sources

### Complete the job instead of cloning the interface

The organizer repeatedly says that exact Sessionboard fidelity is not the goal. A different interface is acceptable if it supports the real workflow cleanly.

### Optimize for nontechnical operators

The customer is an event-production team, not a software team. Common actions should be obvious, terminology should match event work, and the application should not require technical knowledge of Airtable, APIs, or automation internals.

### Prefer a working vertical workflow over broad feature coverage

The strongest demonstration is an end-to-end flow that genuinely works: create a form, submit a talk, review it, accept it, onboard the speaker, send communication, and schedule the session.

### Make it fast

Sessionboard's slowness was called out repeatedly in the walkthrough. Perceived performance and responsive interaction are meaningful differentiators and receive explicit competition bonus consideration.

### Use product judgment

Not every state and edge case is specified. The organizer expects entrants to apply common sense and product judgment. Subjective judgment about what the event team would actually use is also the competition tiebreaker.

## Competition rules and incentives

- Target submission deadline: Wednesday, August 12 at 10:00 PM Pacific.
- A submission requires the organizer's submission form, an open-source repository, a deployed site that can be tested, and a walkthrough.
- Valid serious attempts may request reimbursement for up to $500 of token cost with proof. Usage of Codex Pro or Claude Max subscriptions was explicitly said to count.
- The winning submission receives $10,000.
- The winner will participate in a call or interview for a Latent Space write-up.
- The AI Engineer team, rather than only the organizer, will independently evaluate submissions.
- The tiebreaker favors product decisions that make the result something the customer would actually use or buy.
- Any agent, language, framework, or tool is allowed.
- Mild bonus points were mentioned for Cloudflare infrastructure.
- Bonus points were mentioned for Airtable persistence.
- Very small bonus points were mentioned for hosting on Forge instead of GitHub.
- Speed and performance earn bonus consideration.
- An API earns bonus consideration.
- The organizer planned additional clarification videos and intended to freeze new requirements after the weekend. Later videos or Discord announcements should therefore be checked before finalizing scope.

## Evaluation expectations

The product should be demonstrable to real event professionals without extensive explanation. A strong evaluation path would show that an administrator can:

1. Create or open an event.
2. Configure and publish a CFP form.
3. Submit a realistic talk through the public form.
4. Find that submission in the admin application.
5. Route or expose it to the correct track reviewer.
6. Review and accept it.
7. See the resulting speaker, session, and onboarding tasks.
8. Complete or inspect speaker-portal work.
9. Send a real email and calendar invitation.
10. Place the session on an agenda.
11. Trigger and resolve a scheduling conflict.
12. View the resulting public program.

This is an acceptance-oriented reading of the collected evidence, not a committed build plan.

## Agentic functionality

The Sessionboard marketing site emphasizes agent-native and AI features, but the competition organizer clarified that a small useful agent is enough and the administrator UI is the priority.

No exact agent behavior has been required. A narrow assistant that reduces real administrative work is more aligned with the brief than a broad chatbot added only to claim AI functionality.

## Naming context

`OpenSessionBoard` is a temporary project name. Final naming is still in progress.

Other contestants have already announced the names `opensession`, `Program Cue`, and `SuperStage`. The final name should avoid confusion with those projects and with established event-software brands.

## Known ambiguities and open questions

- What exact event fields are required beyond name, dates, tracks, and rooms?
- Which form-field types and conditional operators are necessary for the demonstration?
- How should reviewers authenticate, and can administrators override their decisions?
- Are numerical scores needed in addition to approve/maybe/deny for judging?
- What precise events trigger reminder emails?
- Which email identity, sending domain, and reply-to behavior should be used?
- How should calendar invitation updates and cancellations behave?
- Which conflict types beyond speaker and room overlap matter?
- What exact Airtable tables, fields, and automations exist?
- Is Airtable mandatory for the winning deployment or only bonus-worthy?
- How much of the public speaker gallery and agenda embedding must be implemented?
- What is the smallest useful agentic feature the customer would value?
- What requirement was described as "nice to have" in an earlier Discord reply whose original question was not included in the copied thread?
- Will the promised follow-up video introduce or freeze any additional requirements?
- What final submission form and judging rubric will be provided?

## Current evidence boundaries

- The Google Doc was successfully exported as PDF and DOCX. All 37 pages and 40 original images are available locally and were visually reviewed.
- The full available YouTube captions, metadata, description, thumbnail, and timestamped transcript were captured locally.
- Discord evidence is partial. It currently consists of user-provided channel copy/paste and screenshots, including direct organizer answers. Unexpanded Discord threads may contain additional clarification.
- The public Sessionboard website describes a much larger product than the competition MVP. Its full feature set should not be mistaken for required scope.

## Short version

Build a fast, polished admin-first event-program tool that lets a nontechnical team collect speaker submissions, review them by track, accept speakers, generate onboarding work, send real communications, and schedule sessions without conflicts. Demonstrate the complete workflow. Skip payments and Accelevents, keep AI small, and do not waste the weekend cloning unrelated Sessionboard features.
