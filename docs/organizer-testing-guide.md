# Creating test accounts on a deployed Greenroom instance

This guide is for competition organizers and evaluators who need production-like admin, reviewer, and speaker identities on a deployed Greenroom app. It requires only a browser and real inboxes—no local setup, seed data, or database access.

Replace:

- `<deployment>` with the deployed origin, for example `https://events.example.com`.
- `<event-slug>` with the event slug shown in its organizer URL.
- `<form-slug>` with a published CFP form's slug.

## Before you begin

Prepare three separate inboxes that you control:

1. An admin inbox
2. A reviewer inbox
3. A speaker/submitter inbox

A fourth inbox is useful for testing a second admin or co-speaker. Do not use shared seeded/demo credentials or another evaluator's account.

Use a separate browser profile or private-browser context for each identity. That prevents one role's session cookie from replacing another's and makes authorization checks trustworthy. Label the windows before continuing.

Every Greenroom role uses email magic links; there are no passwords. On a deployed instance, requesting, inviting, or resending a link sends real email through SendGrid. A working production email configuration is therefore required even for sign-in. Magic links prove control of the recipient inbox and should be treated like passwords: do not paste them into reports, screenshots, chat, or shared notes.

Ask the deployment owner for:

- `<deployment>` and an event you may use or permission to create one;
- an existing admin invitation, or confirmation that your admin email is configured in `ADMIN_EMAILS`;
- permission to send real invitation/sign-in emails to your controlled inboxes.

## 1. Establish the first admin

Open `<deployment>/login`, enter the admin email, and request a magic link. Open the newest link in that inbox.

Expected result: sign-in passes through `<deployment>/dashboard` and lands at `<deployment>/admin`. The admin can see the event index and create or open events.

A new email does **not** become the first admin merely by signing in. New accounts default to Speaker. On a fresh deployment, the deployment owner normally includes the first admin in the `ADMIN_EMAILS` environment setting. An address on that list is promoted whenever it signs in, including an existing account.

Removing an address from `ADMIN_EMAILS` does not demote an existing admin. Conversely, demoting an address in the UI while it remains in `ADMIN_EMAILS` is temporary: its next sign-in promotes it again. The deployment owner must remove it from the setting before permanent demotion.

If the first admin cannot land at `/admin`, stop and ask the deployment owner to correct provisioning. Do not try multiple arbitrary addresses and do not assume the first successful signup wins admin access.

## 2. Create or choose the test event

From `<deployment>/admin`, open an event or choose **New event** and create one with a clearly disposable name, such as `EVAL-<date>-Account Test`. Note its slug.

The account-management page is:

`<deployment>/admin/<event-slug>/team`

Only an existing admin can open it. The page is titled **Team** and contains **Admins and reviewers** and **Add a teammate**.

## 3. Add a second admin

Using a second admin is recommended before changing any roles. It also lets you verify the last-admin safeguard.

1. As the existing admin, open `<deployment>/admin/<event-slug>/team`.
2. Under **Add a teammate**, enter the second admin's controlled email.
3. Enter a name if desired and choose **Admin**.
4. Submit the form. This creates or promotes the account immediately and sends a real invitation email.
5. Open the invitation in the second admin's separate browser context.

Expected result: the second identity lands at `<deployment>/admin` and has full organizer access. The Team row loses its **Not signed in yet** badge after first sign-in.

If the address already had a Greenroom account, the action changes its role instead of creating a duplicate. A name typed during this promotion does not overwrite that existing account's chosen profile name; use **Edit name** on the Team row if a correction is needed.

Admin is an organization-wide role, not an event-only membership. Promoting someone to Admin gives them organizer access to all events on that Greenroom deployment. Use only trusted test identities.

## 4. Add a reviewer and assign tracks

Reviewers need both the Reviewer role and at least one track assignment for the event.

1. As admin, return to `<deployment>/admin/<event-slug>/team`.
2. Under **Add a teammate**, enter the controlled reviewer email and optional name.
3. Choose **Reviewer** and submit. This writes the role immediately and sends a real invitation email.
4. In that reviewer's row, choose **Edit tracks**.
5. Select one or more tracks for this event and save.
6. Open the invitation in the reviewer's separate browser context.

Expected result: the reviewer lands at `<deployment>/admin`, but sees only events where they have an assigned track. Inside this event their navigation is limited to **Overview**, **Submissions**, and **Review rounds**. Their queue is limited by the assigned tracks, and explicit review-round assignments are still required before they can submit a scorecard.

A Reviewer with no selected tracks has no access to that event. The Team page warns the admin with **No tracks — empty queue** until at least one track is selected. Track assignments are event-scoped, so repeat **Edit tracks** for each event the reviewer should test.

The Reviewer role itself is account-wide. Changing that account to another role affects its access across the deployment, even though its track routing is configured per event.

## 5. Create a useful speaker/submitter identity

The Team page adds only Admins and Reviewers. Create a speaker identity through a real speaker workflow instead.

### Recommended: public CFP ownership

1. As admin, publish a disposable CFP form and copy its public URL:

   `<deployment>/submit/<form-slug>`

2. In the speaker's signed-out browser context, submit a test proposal using the controlled speaker email. A final submission sends a real confirmation email; saving a draft sends a real resume email.
3. Open `<deployment>/login`, request a magic link for that same email, and open it in the same speaker context.

Expected result: the speaker lands at `<deployment>/portal` and sees the proposal associated with that email. They can edit their own submission but cannot see another speaker's records or enter the organizer area.

For a draft test, save rather than submit, open the emailed resume link, and later sign in with the same email. A signed-in speaker returning to the form should be directed back to their existing draft rather than silently receiving a blank form.

### Alternative: organizer-created speaker

An admin may add a speaker from `<deployment>/admin/<event-slug>/speakers` or create one through acceptance of a proposal. On the speaker's record, use the portal-invitation action to send a real sign-in email. This is the better path when the evaluator needs to test the portal without creating a public proposal.

Expected result: the speaker signs in at `<deployment>/portal`. A manually added speaker may initially have no submissions, sessions, or tasks; that empty state is expected until the admin connects work to the record.

Signing in with an otherwise unknown email also creates a Speaker account, but it will have no event relationship. Use the CFP or organizer-created path for a meaningful test identity.

## 6. Fresh links and handover

On `<deployment>/admin/<event-slug>/team`, each Admin or Reviewer row offers:

- **Send sign-in link** — sends a fresh, one-click magic link to that real inbox and logs the send.
- **View link** — shows/copies `<deployment>/login` with the email address prefilled.

The handover URL from **View link** is not an authenticated session and is safe to give directly to the intended evaluator. They must still request and open a magic link delivered to that inbox. Prefer this handover when email delivery of the original invitation failed but the recipient can request a new sign-in themselves.

Invitation or resend failure does not undo the role/account write. Read the success/error message carefully: a person may already be an Admin or Reviewer even when the email failed. Confirm the row first, then use **Send sign-in link** once or share the prefilled login page. Avoid repeated sends, which create real email and communication-log entries.

Magic links should be opened in the browser context intended for that role. If a link opens in the wrong profile, sign out there and request a fresh link in the correct context rather than copying an authenticated session between people.

## 7. Verify the three identities

Use these minimal landing and access checks:

| Identity | Expected landing | Expected access |
| --- | --- | --- |
| Admin | `<deployment>/admin` | All events and organizer pages |
| Reviewer | `<deployment>/admin` | Only track-assigned events; only Overview, Submissions, and Review rounds within them |
| Speaker | `<deployment>/portal` | Only their own profile, submissions, sessions, and tasks |

Also verify:

1. The Reviewer cannot open `<deployment>/admin/<event-slug>/team` or other admin-only pages by typing the URL directly.
2. The Speaker cannot open `<deployment>/admin` or another speaker's portal record.
3. A signed-out browser is redirected to `<deployment>/login` from authenticated routes.
4. The Reviewer loses access to this event after all of their tracks are unticked, then regains it after the intended tracks are restored.

Do not use one browser session and merely change the email in the address bar; role enforcement depends on the authenticated session, not a URL parameter.

## 8. Safe cleanup

Greenroom has no production reset or account-delete workflow. Cleanup means removing elevated access and retiring disposable content without erasing audit history.

1. Confirm at least one trusted Admin can still sign in.
2. If a test admin is listed in `ADMIN_EMAILS`, ask the deployment owner to remove it there before demoting it in the UI.
3. On `<deployment>/admin/<event-slug>/team`, change the disposable Reviewer or Admin to **Remove from team** and confirm the prompt.
4. Verify the removed identity now lands as a Speaker and no longer opens organizer pages.
5. Unpublish the disposable CFP form so no new anonymous submissions arrive.
6. Leave the deployment owner the unique event/form/account labels for any records that remain.

The UI refuses to remove the only Admin and shows **The only admin — promote someone else first.** Test this safeguard by observing the disabled role control; do not attempt database workarounds.

Use a reviewer identity created solely for this evaluation. Removing a Reviewer from the team demotes the account to Speaker, clears its reviewer track routing, and removes unfinished round assignments across the deployment; filed scorecards remain as historical work. It is not a narrowly event-scoped cleanup action.

Removing someone from the team does not delete their account, proposals, speaker profile, sent-email log, or completed review work. Real invitation, magic-link, confirmation, and portal emails cannot be recalled. Never clean up by seeding, resetting, or directly editing the production database.

## Troubleshooting sign-in

- No email: check spam, wait for the provider, then ask the deployment owner to verify SendGrid and its verified sender. Use **Send sign-in link** once after configuration is confirmed.
- Link points to the wrong host: the deployment owner's canonical `BETTER_AUTH_URL`/`APP_URL` configuration needs correction.
- Correct inbox, wrong landing: inspect the Team role and reviewer tracks as Admin; do not create another account with an email spelling variation.
- Team row still says **Not signed in yet**: the recipient has not completed a magic-link sign-in for that exact normalized email.
- Page hangs without an error: retry once in a fresh tab and record the route, local timestamp/timezone, role, and whether another request was in flight. Rare OpenNext/Cloudflare request stalls are a known deployment issue; do not reset or reseed production as recovery.

When reporting an account problem, include the deployed revision if known, route, role, exact actions, expected/actual landing, and a redacted email. Never include a magic-link token, session cookie, or full email/API credential.
