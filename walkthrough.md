# Greenroom — recorded demo walkthrough

**Runtime:** ~11 minutes. **Audience:** competition judges watching a screen recording.
**Rule for the whole script:** every URL, button label, and form value below is copy‑paste‑ready and was clicked live against a running Greenroom. Say the *why* line, then do the clicks.

---

## Cold open (read this over the first shot)

> "This is Greenroom — an open-source replacement for Sessionboard. Everything you're about to see is one app: the call for speakers, the review queue, the accept that turns a proposal into a session, the speaker's onboarding checklist, the agenda, the emails, the calendar invites, and the public program. No Airtable base behind it, no Zapier glue, no spreadsheet anyone has to remember to update. I'm running the AI Engineer Summit 2026 — three days at Moscone West, a call for speakers that's open right now — and in the next ten minutes I'm going to take one talk from *nobody has heard of it* to *it's on the public schedule and the speaker has a calendar invite*."

Open on **Window A**, the admin, sitting on `http://localhost:3000/admin/ai-engineer-summit-2026/submissions`.

---

## Prep before recording

Run these once, in order, from the repo root:

1. `npm run seed` — resets the demo database. **Do this even if you seeded yesterday**: the script depends on the seeded schedule being exactly three placed sessions, and on the reminder cooldown being clear.
2. `npm run dev` — leave it running on `http://localhost:3000`. Keep this terminal visible in a split or a second monitor: the dev email transport prints every message it sends as `>> EMAIL (dev transport)`, and that live printout is the proof that "it sent an email" isn't a toast lying to you.
3. `rm -f .dev-magic-links.log` — so the link you grab on camera is unambiguously the newest one.

**Three browser windows, pre-arranged:**

| Window | Who | Pre-open on | Signed in? |
| --- | --- | --- | --- |
| **A** | Organizer — Avery Chen (`admin@greenroom.dev`) | `/admin/ai-engineer-summit-2026/submissions` | **Yes, sign in before you hit record** |
| **B** | Track reviewer — Dana Okoye (`dana@greenroom.dev`) | `/admin/ai-engineer-summit-2026/submissions` | **Yes, sign in before you hit record** |
| **C** | The public / the speaker | `/submit/ai-engineer-summit-2026` | **No — keep it signed out** (use a private window) |

**On the magic-link flow — my call:** pre-authenticate A and B off camera, and show the magic-link sign-in exactly once, live, in Act 6, when the newly accepted speaker opens her portal. Doing it three times is dead air; doing it once, at the moment a real speaker would do it, is the strongest possible spot for "there are no passwords in this product." To sign in A and B beforehand: enter the email at `/login`, click **Send magic link**, then `tail -n 1 .dev-magic-links.log` and paste the third tab-separated column into the address bar.

**One thing to avoid on camera:** don't reload mid-drag on the agenda board.

**Have this ready to paste** (Act 2): see the [Copy-paste block](#copy-paste-block) at the bottom.

---

## Act 1 — The call for speakers is a thing you configure, not a thing you file a ticket for
*(~1:15)*

**Say:**
> "Organizers change their CFP form constantly — a new question, a conditional follow-up, co-speakers on or off. In Sessionboard that's a support conversation. Here the form *is* data: questions, conditions, the welcome copy, the confirmation email, and the public link all live on one screen."

**Do** — in **Window A**:

1. Go to `http://localhost:3000/admin/ai-engineer-summit-2026/forms`. Point at the row **Call for Speakers 2026**, status **Open**. Click it.
2. On the **Questions** tab, scroll to the row labelled **Workshop requirements** — note its **Conditional** badge. Click the row to expand it and read out the condition: **When** *Session format* — **Comparison** *is* — **This answer** *90-minute workshop*. Collapse it again.
   > "That question only exists if you pick 'workshop'. The organizer built that rule in the UI. Nobody deployed anything."
3. Find the **Allow co-speakers** switch and turn it **on**.
   > "Most conference talks have two people on stage. Sessionboard treats the second one as an afterthought — here they're a first-class part of the proposal, and every email we send goes to both."
4. Click the **Welcome & confirmation** tab. Point at **Confirmation email** — Subject and Body — and at the **Available merge fields** list and the **Preview**.
5. Click the **Window & link** tab. Point at **Public link** (`/submit/ai-engineer-summit-2026`), **Opens**, **Closes**.
6. Click **Save**. Wait for the **Form saved** toast.

---

## Act 2 — A speaker submits, with no account, and gets a real email
*(~1:30)*

**Say:**
> "Here's the speaker's side. No login wall, no 'create an account to propose a talk' — that's the single biggest reason CFP conversion dies."

**Do** — switch to **Window C** (signed out), at `http://localhost:3000/submit/ai-engineer-summit-2026`:

1. Read the top line out loud: *"We're looking for practitioner talks: things you built, shipped, measured, and would do differently."*
2. **Talk title:** `Catching silent regressions before your users do`
3. **Abstract:** paste the abstract from the [copy-paste block](#copy-paste-block).
4. **Track(s):** tick **Evals & Reliability**.
5. **Session format:** choose **90-minute workshop** first — the **Workshop requirements** question appears. Then change it to **45-minute talk** and the question disappears again.
   > "That's the conditional rule from thirty seconds ago, doing its job on the public form."
6. **Speaker biography:** `Runs the reliability team behind a support-automation product used by 2,000 companies. Spends most of her week reading traces.`
7. **Link to a previous talk:** `https://www.youtube.com/watch?v=aie-evals`
8. Tick **I agree to the code of conduct**.
9. **Your name:** `Nadia Farouk` — **Your email:** `nadia.farouk@example.com`
10. Click **Add a co-speaker**. Fill **Name** `Owen Diallo`, **Email** `owen.diallo@example.com`, **Job title (optional)** `Staff Engineer`, **Company (optional)** `Waypoint`.
11. Click **Submit proposal**.

You land on the confirmation page: **Proposal received**, the talk title, the organizer's own confirmation copy, and *"A confirmation email is on its way to nadia.farouk@example.com."*

**Say, pointing at the terminal:**
> "And there it is — two emails, one to Nadia and one to Owen, with the subject the organizer wrote on that Welcome & confirmation tab, merge fields already filled in. That's not a queue I'm promising to drain later. It's gone."

Point at the terminal split: two `>> EMAIL (dev transport)` blocks, `Subject: We received your talk proposal — Catching silent regressions before your users do`, bodies starting `Hi Nadia,` / `Hi Owen,`. Then point back at the page: **Sign in to edit your proposal** — *"she can come back and edit it, from the same email, no password."*

---

## Act 3 — It's in the queue, and the organizer can ask for a fix without deciding anything
*(~1:15)*

**Say:**
> "Back in the organizer's seat. Every proposal, one queue, statuses in organizer language."

**Do** — **Window A**, `http://localhost:3000/admin/ai-engineer-summit-2026/submissions`:

1. Set **Filter by status** to **Unreviewed**. The count line updates to *N of 16 submissions*. The new talk is at the top, showing **Nadia Farouk, Owen Diallo** and the track **Evals & Reliability**.
2. Click **Catching silent regressions before your users do**.
3. Scroll the **The proposal** card — every answer as she gave it, including the co-speaker row *Owen Diallo — owen.diallo@example.com — Staff Engineer, Waypoint*.

**Say:**
> "Now the thing every program chair does forty times a CFP and no tool supports: the abstract is nearly right. I don't want to accept it, I don't want to reject it, I want to ask for one change — and I want that ask to be an email, not a note to myself."

4. Click **Request changes**. Read the dialog line: *"Emails the speaker what to fix, with a link to edit their proposal. The submission keeps its current status."*
5. **What needs changing:**
   `Great topic. Two things before we decide: trim the abstract to 100 words, and add one concrete before/after number from the regression you caught.`
6. **Due by (optional):** pick a date a few days out.
7. Click **Send request**. Toast: **Change request sent**.

**Say:**
> "That went out as a real email — subject line *A quick change needed on 'Catching silent regressions…'* — with the deadline and a link that opens her proposal, ready to edit. And look at the status: still **Unreviewed**. Asking for a fix isn't a decision, so it doesn't pretend to be one."

Point at the terminal for the third `>> EMAIL` block, then at the unchanged **Unreviewed** badge.

---

## Act 4 — The right reviewer sees it, and only the right reviewer
*(~0:50)*

**Say:**
> "Dana Okoye reviews the Evals & Reliability and AI Engineering tracks. Marco Silva reviews Agents & Tool Use. Routing by track is table stakes, and it has to work in both directions."

**Do** — switch to **Window B** (Dana), `http://localhost:3000/admin/ai-engineer-summit-2026/submissions`:

1. Header reads *"The talks proposed in the tracks you review. Open one to record your recommendation."* The new Evals talk is in her list.
2. Scroll the list and point out that **Tool schemas are your real prompt** — an Agents & Tool Use talk — **is not there**. If you want the hard version: paste that submission's URL from Window A into Window B and show it **404s**.
   > "Not 'access denied', not greyed out. For Dana, that talk does not exist."
3. Open the Evals talk. In **Your review**, click **Approve** and type in the comment box:
   `Yes. This is the talk our attendees keep asking for, and she has the production numbers to back it. Ask her to keep the tooling vendor-neutral.`
4. Click **Save review**. The tally under it becomes **1 review: 1 approve.**
5. Point at the panel below it: *"An event admin records the final decision. Your recommendation above is what feeds it."*
   > "Dana can't accept it. Accepting creates a session, assigns onboarding tasks, and emails a promise to a human being — so that's the organizer's signature, not a reviewer's."

---

## Act 5 — One click turns a proposal into a session, a checklist, and a promise
*(~1:10)*

**Do** — back to **Window A**, same submission page (reload it):

1. Dana's recommendation is now on the page under **Reviewer notes**, with her name, an **Approve** badge, and her comment.
2. In the **Decision** card, type the note:
   `Congratulations — we'd love this on the Evals & Reliability track. Aim for 45 minutes with 10 for questions, and please keep the production numbers in.`
   *(The confirm dialog repeats this field, so typing it there instead also works.)*
3. Leave **Email the speakers** ticked. Click **Accept**.
4. Read the confirmation aloud: *"This creates the session and the speakers' onboarding tasks, and emails everyone on the talk."* Click **Confirm accept**.

**Say, while the toast is up:**
> "Session created. Twelve onboarding tasks assigned across two speakers — six each, automatically, because we accepted a talk with a co-speaker on it. Two emails out. That's the entire manual handoff between 'program committee' and 'speaker ops' — the part every conference runs on a spreadsheet and a prayer — collapsed into one button."

5. Reload. Point at the three lines in the Decision card:
   - **Accepted by Avery Chen** on today's date, with **Note to speakers:** echoed underneath.
   - **Session created — not yet placed on the agenda.**
   - **12 onboarding tasks assigned across 2 speakers.**
   > "Note what it does *not* do: it doesn't guess a room and a time. An accepted talk is unscheduled until a human puts it somewhere."
6. Switch to the terminal and scroll to the acceptance email. Read the two things that matter:
   - *"A note from the review committee:"* followed by the exact note you typed.
   - The **Still outstanding** list — all six tasks with their due dates, in the email itself.
   > "The feedback I typed is in the email. And the speaker's checklist is in the email, so it works even for the speaker who never opens the portal."

---

## Act 6 — The speaker portal, and the only magic link in this demo
*(~1:10)*

**Do** — **Window C** (the signed-out one):

1. Go to `http://localhost:3000/login`. Read the line: *"Admins, reviewers, and speakers all sign in with a magic link — no password."*
2. **Email:** `nadia.farouk@example.com` → **Send magic link**.
3. In the terminal, run `tail -n 1 .dev-magic-links.log`, copy the URL (third column), paste it into Window C.
   > "In production that's a Resend email. In this demo the dev transport writes it to a file so you can watch it happen."
4. You land on **Your speaker home**. Walk it top to bottom:
   - **Your submissions** — her talk, badged **Approved**.
   - **Your sessions** — her session, **Not yet scheduled**. *"Honest about the state of the world."*
   - **Your tasks** — all six, created by that one Accept click: **Hotel stay requirement form**, **Flight reimbursement form**, **Finalize talk description** (**Overdue**), **Finalize bio & photos** (**Due soon**), **Announce participation**, **Invite colleagues with speaker discount**.
   > "These are the six things every conference chases every speaker for. They exist because the talk was accepted. Nobody created them."
5. Do one, inline — no navigation, no separate portal:
   - On **Hotel stay requirement form**, **Do you need us to book your hotel room?** → **Yes, book me a room**. Two date fields and a room preference appear.
     > "Same conditional-form engine as the CFP. One form system, used everywhere."
   - **Check-in date (YYYY-MM-DD):** `2026-09-22` — **Check-out date (YYYY-MM-DD):** `2026-09-26`
   - **Room preference:** **One queen bed**
   - **Anything else about your stay?** `Arriving late Tuesday — a quiet floor would be great.`
   - Click **Submit**. The task flips to **Complete**.
6. Point at the other task types without doing them: **Finalize talk description** has **Mark as done**; **Finalize bio & photos** has **Upload a file**.

**Do** — **Window A**, `http://localhost:3000/admin/ai-engineer-summit-2026/speakers`:

7. *"And on the organizer's side, that submission is already visible."* Find the **Nadia Farouk** row: **1/6 (17%)** completion and **1** overdue, with her outstanding tasks listed. Scan up the column — the seeded speakers sit anywhere from 0/6 to 6/6.
   > "This is the screen that replaces the 'who still hasn't sent a headshot' spreadsheet."

---

## Act 7 — The agenda: cause a conflict on purpose, then fix it
*(~1:10)*

**Do** — **Window A**, `http://localhost:3000/admin/ai-engineer-summit-2026/agenda`:

1. Read the page line: *"Drag sessions from the tray onto a room and time. Conflicts are flagged, never blocked."* Point at **No scheduling conflicts** in the top right.
2. The **Unscheduled** tray on the right holds four cards, including **Catching silent regressions before your users do** with *Nadia Farouk, Owen Diallo* on it. Day 1 is selected; **Retrieval that survives production traffic** sits on **Main Stage** at **10:00 AM – 10:45 AM**. (Room columns are alphabetical: Community Hall, Main Stage, Workshop A, Workshop B.)
3. **Drag the new card out of the tray and drop it on Main Stage at 10:00** — straight on top of Priya's talk. The slot highlights as you cross it.

**Say:**
> "Watch what it does *not* do. It doesn't refuse the drop. Organizers double-book on purpose all the time while they're thinking. It takes the placement and then tells the truth about it."

4. Both cards are now outlined in red. The new card reads **Room double-booked**. Top right, the summary button reads **1 conflict** — click it.
5. In the **Scheduling conflicts** popover, read the message: *"'Catching silent regressions before your users do' and 'Retrieval that survives production traffic' are in the same room at the same time."* Point at the **Show on …** link (it names event day 1 — the seed places the event ~45 days out, so the exact date depends on when you seeded). Press `Esc`.
6. Reload the page. The conflict is still there.
   > "A conflict is never a reason to drop your change."
7. Click the new card. In the dialog (*"Set the exact day, room, and time. Changes save immediately."*), set **Room** → **Workshop B**, **Start** → `13:00`, **Duration** → **45 minutes**. Click **Save time**.
8. The red clears; the top right returns to **No scheduling conflicts**; the card reads **1:00 PM – 1:45 PM**.
   > "Speaker double-bookings and room double-bookings are hard conflicts. Two talks from the same track opposite each other is an amber advisory — flagged, because attendees hate it, but not treated as an error."

---

## Act 8 — Real email, on a cadence, in the organizer's own words
*(~1:20)*

**Do** — **Window A**, `http://localhost:3000/admin/ai-engineer-summit-2026/communications`:

1. The **Log** tab is the per-speaker correspondence history — the acceptance email and the change request you just sent are both in it. Show **Filter by speaker** and **Filter by message type**.

**Say:**
> "Three things here that conferences actually pay for."

**(a) Deadline reminders that don't spam.**

2. Click **Send reminders now**. The toast reports what it did *and what it deliberately didn't* — e.g. **Sent 8 reminders**, *"Skipped 58: 31 already done, 23 not due yet, 4 reminded in the last few days."*
   > "Every skip has a reason. That breakdown is the difference between a cron job you trust and one you turn off."
3. Click it again. **No reminders needed** — *"Nothing was due: … reminded in the last few days."*
   > "Three-day cooldown per task. Press the button as often as you like; nobody gets nagged twice."

**(b) The wording is yours.**

4. Open the **Templates** tab — seven built-in messages, from **Submission received** to **Calendar invitation**. Click **Task / deadline reminder**.
5. Type `See you in {{sessionRoom}}.` at the end of the body. It's refused: the merge field is real but a reminder can't fill it, and **Save wording** goes disabled.
   > "It would have arrived as a blank space in someone's inbox. Nobody re-reads sent mail, so we catch it here."
6. Replace it with `Our team is around all week if you're stuck, {{speakerFirstName}}.` and click **Save wording**. Toast: **Saved "Task / deadline reminder"**. An **Edited** badge appears next to it.
   > "That's this event's wording now — an override, not a fork. Every other event keeps the default."
7. Click **Use Greenroom's wording**. Toast: **Back to Greenroom's wording**, and the built-in copy returns.
   > "One click back. You can never paint yourself into a corner."

**(c) A calendar invite that updates instead of duplicating.**

8. Open **Calendar invites**. Find the row for **Catching silent regressions before your users do** — it shows the slot you just gave it, *Workshop B*, and both speakers. Click **Send invitation** → **Invitation sent to 2 speakers**.
9. In the terminal, point at the attached `.ics`: `METHOD:REQUEST`, `SEQUENCE:0`, a stable `UID:session-…@greenroom.dev`, and `LOCATION:Workshop B, Moscone West, San Francisco`.
   > "That's a real calendar invitation. It lands in Google Calendar and Outlook as an event, not as a text file."
10. Reload the tab. The row now reads **2 invites sent** with a **Last sent** timestamp. Click **Re-send invitation** → **Updated invitation sent to 2 speakers**, *"Their existing calendar entry updates in place."* Point at the new `.ics`: same UID, now **`SEQUENCE:1`**.
    > "Rooms change. When they do, the speaker's existing calendar entry moves — they don't get a second invite to delete."

---

## Act 9 — The public program, and the embed
*(~0:45)*

**Do** — **Window C**, signed out:

1. Go to `http://localhost:3000/p/ai-engineer-summit-2026`. Event name, the three-day date range (~45 days out, from the seed) *· Moscone West, San Francisco*, and a link straight to the open call for speakers.
2. Click **Schedule**. Day tabs; on day 1, **Catching silent regressions before your users do**, **1:00 PM – 1:45 PM**, **Workshop B**, Nadia Farouk and Owen Diallo.
   > "Forty seconds ago that was a card I dragged. There is no publish step, no export, no second CMS."
3. Click **Speakers** — she's on the speaker wall.
4. Back on **Schedule**, click the **`</> Embed`** button. Read the popover: **Embed this page** — *"Paste this into any HTML page to show it there, chrome-less."* Show the snippet:
   ```html
   <iframe src="http://localhost:3000/embed/ai-engineer-summit-2026/schedule" title="Event program" width="100%" height="720" style="border:0;" loading="lazy"></iframe>
   ```
5. Click **Copy code** (toast: **Embed code copied**), then open `http://localhost:3000/embed/ai-engineer-summit-2026/schedule` directly — same schedule, no navigation, no branding.
   > "Every conference wants the schedule on its own marketing site. This is the whole integration: one iframe, and it stays live."

---

## Close

> "One talk, ten minutes: proposed by someone with no account, routed to the right reviewer and hidden from the wrong one, sent back for a fix, accepted with feedback that reached the speaker's inbox, turned into a session and twelve onboarding tasks nobody typed, scheduled through a conflict and out the other side, invited to the calendar, and published to a public page you can embed anywhere. Greenroom is open source, it deploys to Cloudflare Workers, and the whole data layer sits behind a storage-agnostic repository interface — so this same product runs on D1, Postgres, or anything else you point it at. Thanks for watching."

---

## Copy-paste block

**Abstract (Act 2):**

```
Our eval suite stayed green for three weeks while support tickets doubled. This talk is the instrumentation we added to close that gap: production traces sampled into a golden set, per-release diffing, and an alert that fires on behaviour change rather than on a score. You'll leave with a checklist you can run against your own stack on Monday.
```

**Speaker bio (Act 2):**

```
Runs the reliability team behind a support-automation product used by 2,000 companies. Spends most of her week reading traces.
```

**Change request (Act 3):**

```
Great topic. Two things before we decide: trim the abstract to 100 words, and add one concrete before/after number from the regression you caught.
```

**Reviewer comment (Act 4):**

```
Yes. This is the talk our attendees keep asking for, and she has the production numbers to back it. Ask her to keep the tooling vendor-neutral.
```

**Decision note (Act 5):**

```
Congratulations — we'd love this on the Evals & Reliability track. Aim for 45 minutes with 10 for questions, and please keep the production numbers in.
```

**Template edits (Act 8):** bad → `See you in {{sessionRoom}}.` · good → `Our team is around all week if you're stuck, {{speakerFirstName}}.`

---

## Presenter's cheat sheet

**Accounts:** `admin@greenroom.dev` (Avery Chen, admin) · `dana@greenroom.dev` (Dana Okoye, reviews *AI Engineering* + *Evals & Reliability*) · `marco@greenroom.dev` (Marco Silva, reviews *Agents & Tool Use*) · `nadia.farouk@example.com` (created live in Act 2).

**Seeded fixtures the script leans on:**

- Event **AI Engineer Summit 2026**, slug `ai-engineer-summit-2026`, three days starting ~45 days after you seed (the exact day rounds via UTC, so it can land a day later), `America/Los_Angeles`, Moscone West, San Francisco.
- Tracks: **AI Engineering**, **Agents & Tool Use**, **Evals & Reliability**. Rooms: **Main Stage** (1200), **Workshop A** (120), **Workshop B** (120), **Community Hall** (300).
- Placed on day 1: **Retrieval that survives production traffic** (Priya Raman) Main Stage 10:00–10:45; **Cutting inference spend by 80% without touching quality** (Tom Beckett) Community Hall 11:00–11:30. Day 2: **Shipping an agent into a hospital** Main Stage 14:00–14:45.
- In the unscheduled tray: **Evals you'll actually keep running** (Hannah Kim), **Tool schemas are your real prompt** (Damola Oyelaran), **Hands-on: building a recovery loop for flaky agents** (Sofia Rossi). Your new talk makes four.
- The six canonical onboarding tasks, in portal order: Hotel stay requirement form, Flight reimbursement form, Finalize talk description *(seeded 3 days overdue)*, Finalize bio & photos *(due in 2 days)*, Announce participation, Invite colleagues with speaker discount.

**If something goes sideways mid-take:**

- *The drag doesn't stick* — dnd-kit needs a real pointer path. Press and hold, move ~20px first, then travel to the target; drop only once the slot is highlighted. Fallback: click the tray card and set day/room/time in the dialog instead.
- *"Send reminders now" says "No reminders needed" on the first press* — a previous run is inside the three-day cooldown. Re-seed.
- *Numbers in the reminder toast differ from the script* — expected; they depend on the exact hour you seeded. Only the shape matters: a sent count plus a per-reason skip breakdown.
- *Accept reports 6 tasks across 1 speaker, not 12 across 2* — you skipped the co-speaker in Act 2. Harmless; adjust the line you say.
