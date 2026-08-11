import { addRoom, createDirectSession, expect, test, type IsolatedEvent } from "./fixtures";
import { devEmailsSince, signIn } from "./helpers";
import type { Page } from "@playwright/test";

/**
 * Key flow: communications (spec.md §7) — the per-speaker log, one-off
 * messages with merge fields, per-event template wording, calendar invites,
 * and the weekly task digest (decisions.md D-039).
 *
 * Every assertion that matters checks the *email*, not just the toast: mail
 * that renders in the UI but never leaves the building is the failure mode
 * this screen exists to prevent. The dev transport writes each message to
 * `.dev-emails/`, so a test can read exactly what a speaker would receive.
 *
 * Mutating calendar coverage uses an isolated event; the digest template and
 * send are one scenario so no test depends on a prior template edit.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const COMMS = `/admin/${EVENT_SLUG}/communications`;

const PRIYA = "Priya Raman";
const PRIYA_EMAIL = "priya.raman@example.com";
/** The roster page, for the manual "Add speaker" flow (decisions.md D-051). */
const SPEAKERS = `/admin/${EVENT_SLUG}/speakers`;

/** A speaker entered by hand: no submission, no session, no task — the roster
 * row is her only trace, which is exactly the case that used to drop her out
 * of the recipient picker. Fresh name/address, so nothing else in the suite
 * can be looking at her. */
const MARISOL = "Marisol Thorne";
const MARISOL_EMAIL = "marisol.thorne@example.com";
const MARISOL_COMPANY = "Belmont Foundry";

/** Seeded reviewer (scripts/seed.ts) — the log can name her, the composer
 * must never offer her. */
const DANA = "Dana Okoye";

/** A seeded, speaking speaker who is emphatically not the preview's sample
 * person. */
const HANNAH_EMAIL = "hannah.kim@example.com";

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name }).click();
}

function eventDayLabel(event: IsolatedEvent): string {
  return new Date(`${event.startDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

test("an admin writes a one-off message and it reaches the speaker", async ({ page }) => {
  const startedAt = Date.now();
  // A marker unique to this run, so the assertion can't pass on a stale file.
  const marker = `Shuttle times ${Date.now().toString(36)}`;

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);
  await openTab(page, "Compose");

  await page.getByRole("listitem").filter({ hasText: PRIYA }).getByRole("checkbox").click();
  await page.locator("#compose-subject").fill(marker);

  // A misspelled merge field is caught while it's still being typed: it would
  // arrive as empty space, and nobody re-reads sent mail.
  await page.locator("#compose-body").fill("Hi {{speakerFistName}}, the shuttle leaves at 7.");
  await expect(
    page.getByRole("listitem").filter({ hasText: "Not a merge field" }),
  ).toContainText("{{speakerFistName}}");
  await expect(page.getByRole("button", { name: /^Send to 1 person$/ })).toBeDisabled();

  await page
    .locator("#compose-body")
    .fill("Hi {{speakerFirstName}}, the shuttle to {{eventName}} leaves at 7.");
  // The preview shows the merged copy, not the placeholders.
  await expect(page.getByText("Hi Priya, the shuttle to")).toBeVisible();

  await page.getByRole("button", { name: /^Send to 1 person$/ }).click();
  await expect(page.getByText("Sent to 1 person")).toBeVisible();

  // It really went out, addressed and merged.
  await expect(async () => {
    const mine = (await devEmailsSince(startedAt)).find((body) => body.includes(marker));
    expect(mine).toBeTruthy();
    expect(mine!.match(/^To: (.+)$/m)?.[1]).toBe(PRIYA_EMAIL);
    expect(mine).toContain("Hi Priya, the shuttle to AI Engineer Summit 2026 leaves at 7.");
    expect(mine).toContain("X-Greenroom-Log: manual");
  }).toPass({ timeout: 15_000 });

  // And it's in the log, which is what "communication log per speaker" means.
  await openTab(page, "Log");
  await expect(page.getByRole("cell").filter({ hasText: marker })).toBeVisible();
});

test("an admin sends one personalized announcement to a selected speaker group", async ({
  page,
}) => {
  const startedAt = Date.now();
  const subject = `Welcome, speakers — ${startedAt.toString(36)}`;

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);
  await openTab(page, "Compose");

  for (const email of [PRIYA_EMAIL, HANNAH_EMAIL]) {
    await page.getByRole("listitem").filter({ hasText: email }).getByRole("checkbox").click();
  }
  await page.locator("#compose-subject").fill(subject);
  await page.locator("#compose-body").fill("Hi {{speakerFirstName}}, welcome to {{eventName}}.");
  await expect(page.getByRole("button", { name: "Send to 2 people" })).toBeEnabled();
  await page.getByRole("button", { name: "Send to 2 people" }).click();
  await expect(page.getByText("Sent to 2 people")).toBeVisible();

  await expect(async () => {
    const messages = (await devEmailsSince(startedAt)).filter((body) => body.includes(subject));
    expect(messages).toHaveLength(2);
    expect(messages.some((body) => body.includes("Hi Priya, welcome to AI Engineer Summit 2026."))).toBe(
      true,
    );
    expect(messages.some((body) => body.includes("Hi Hannah, welcome to AI Engineer Summit 2026."))).toBe(
      true,
    );
  }).toPass({ timeout: 15_000 });

  await openTab(page, "Log");
  await expect(page.getByRole("cell").filter({ hasText: subject })).toHaveCount(2);
});

test("the log narrows to one speaker's correspondence", async ({ page }) => {
  // Someone else's mail, seeded: a bounced calendar invite to a co-speaker.
  const OTHER = "l.fernandez@example.com";

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);

  // The To column shows the display name and keeps the address in the cell's
  // title attribute (W25) — the address is the log's identity key, so these
  // assertions target the title rather than the visible text.
  await expect(page.locator(`td[title="${OTHER}"]`).first()).toBeVisible();

  await page.getByLabel("Filter by speaker").click();
  await page.getByRole("option", { name: PRIYA }).click();

  await expect(page.locator(`td[title="${PRIYA_EMAIL}"]`).first()).toBeVisible();
  await expect(page.locator(`td[title="${OTHER}"]`)).toHaveCount(0);

  // Both filters compose: her decisions only.
  await page.getByLabel("Filter by message type").click();
  await page.getByRole("option", { name: "Decision" }).click();
  await expect(page.getByRole("cell").filter({ hasText: "Decision" })).toHaveCount(1);
  await expect(page.getByRole("cell").filter({ hasText: "Submission received" })).toHaveCount(0);
});

test("a saved digest template drives one cooldown-protected send", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);
  await openTab(page, "Templates");

  await page.getByRole("button", { name: "Weekly task digest" }).click();
  const body = page.locator("textarea[id^='body-']");
  const original = await body.inputValue();

  // {{sessionRoom}} is a real merge field — just not one a reminder can fill
  // in, so it would arrive blank. That's a refusal, not a warning.
  await body.fill(`${original}\n\nSee you in {{sessionRoom}}.`);
  await expect(page.getByRole("listitem").filter({ hasText: "no value for" })).toContainText(
    "{{sessionRoom}}",
  );
  await expect(page.getByRole("button", { name: "Save wording" })).toBeDisabled();

  // Outright nonsense is refused too.
  await body.fill(`${original}\n\nThanks, {{organiserName}}.`);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Not a merge field" }),
  ).toContainText("{{organiserName}}");
  await expect(page.getByRole("button", { name: "Save wording" })).toBeDisabled();

  // Valid copy saves and survives a reload as this event's own wording.
  await body.fill(`${original}\n\nOur team is around all week, {{speakerFirstName}}.`);
  await page.getByRole("button", { name: "Save wording" }).click();
  await expect(page.getByText("Saved “Weekly task digest”")).toBeVisible();

  await page.reload();
  await openTab(page, "Templates");
  await page.getByRole("button", { name: "Weekly task digest" }).click();
  await expect(page.locator("textarea[id^='body-']")).toHaveValue(/Our team is around all week/);
  await expect(page.getByText("Edited")).toBeVisible();

  const startedAt = Date.now();
  await page.goto(COMMS);

  await page.getByRole("button", { name: "Send task digest now" }).click();
  // The button opens a confirm dialog first; the real trigger is inside it.
  await page.getByRole("button", { name: "Send digest" }).click();
  // The seed leaves speakers with outstanding tasks, so the first manual run
  // has something to do (the manual path bypasses the Monday window, D-039).
  await expect(page.getByText(/Sent \d+ emails?/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Checked \d+ speakers?: sent \d+, skipped \d+, failed \d+\./)).toBeVisible();

  // The digest uses the wording saved earlier in this same isolated scenario,
  // proving the override reaches the send path rather than only the editor.
  await expect(async () => {
    const digests = (await devEmailsSince(startedAt)).filter((body) =>
      body.includes("X-Greenroom-Log: task_digest"),
    );
    expect(digests.length).toBeGreaterThan(0);
    expect(digests.some((body) => body.includes("Our team is around all week"))).toBe(true);
  }).toPass({ timeout: 20_000 });

  // A second run immediately must be impossible: the cooldown comes from
  // email_log (D-039's 24-hour guard), the page recomputes the eligible
  // count server-side, and a zero-recipient digest greys the button out —
  // so after a reload there is nothing to click.
  const secondRunAt = Date.now();
  await page.reload();
  await expect(page.getByRole("button", { name: "Send task digest now" })).toBeDisabled();
  await expect(
    page.getByText(/Nobody is eligible right now.*24 hours/),
  ).toBeVisible();

  const afterSecond = (await devEmailsSince(secondRunAt)).filter((body) =>
    body.includes("X-Greenroom-Log: task_digest"),
  );
  expect(afterSecond).toHaveLength(0);
});

test("a real room change re-sends the same calendar event with a higher sequence", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const firstRoom = `Alpha ${fixtureId}`;
  const secondRoom = `Beta ${fixtureId}`;
  await addRoom(page, isolatedEvent.slug, firstRoom);
  await addRoom(page, isolatedEvent.slug, secondRoom);
  const session = await createDirectSession(page, isolatedEvent.slug, fixtureId);
  await page.getByTestId("unscheduled-tray").getByText(session.title).click();
  await page.locator("#session-day").click();
  await page.getByRole("option", { name: eventDayLabel(isolatedEvent) }).click();
  await page.locator("#session-room").click();
  await page.getByRole("option", { name: firstRoom, exact: true }).click();
  await page.locator("#session-start").fill("11:00");
  await page.getByRole("dialog").getByRole("button", { name: "Save time" }).click();
  // The dialog closes on the optimistic board update. Wait for the action's
  // success boundary before navigating away so the test cannot cancel the
  // revalidated response stream while the durable write is still settling.
  await expect(page.getByText("Session time saved")).toBeVisible({ timeout: 15_000 });
  const startedAt = Date.now();

  await page.goto(`/admin/${isolatedEvent.slug}/communications`);
  await openTab(page, "Calendar invites");

  const row = page.getByRole("listitem").filter({ hasText: session.title });
  await row.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(/Invitation sent to \d+ speakers?/)).toBeVisible({
    timeout: 30_000,
  });

  await expect(async () => {
    const invites = (await devEmailsSince(startedAt, ".ics")).filter((ics) =>
      ics.includes(session.title),
    );
    expect(invites.length).toBeGreaterThan(0);
    const ics = invites[0];
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain(`LOCATION:${firstRoom}`);
    expect(ics).toMatch(/^UID:session-.+$/m);
  }).toPass({ timeout: 20_000 });

  // A real agenda edit, not merely a second press on the send button.
  await page.goto(`/admin/${isolatedEvent.slug}/agenda`);
  await page.getByText(session.title).first().click();
  await page.locator("#session-room").click();
  await page.getByRole("option", { name: secondRoom, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save time" }).click();
  await expect(page.getByText("Session time saved")).toBeVisible({ timeout: 15_000 });

  // Same UID, higher SEQUENCE and new LOCATION: calendar clients update the
  // existing entry instead of creating a duplicate.
  const resendAt = Date.now();
  await page.goto(`/admin/${isolatedEvent.slug}/communications`);
  await openTab(page, "Calendar invites");
  await expect(row.getByText(/invites? sent/)).toBeVisible();
  await row.getByRole("button", { name: "Re-send invitation" }).click();
  await expect(page.getByText(/Updated invitation sent/)).toBeVisible({ timeout: 30_000 });

  await expect(async () => {
    const invites = (await devEmailsSince(resendAt, ".ics")).filter((ics) =>
      ics.includes(session.title),
    );
    expect(invites.length).toBeGreaterThan(0);
    expect(invites[0]).toContain("SEQUENCE:1");
    expect(invites[0]).toContain(`LOCATION:${secondRoom}`);
  }).toPass({ timeout: 20_000 });
});

test("a reviewer is bounced from communications entirely", async ({ page }) => {
  // D-047: a reviewer's workspace is Overview / Submissions / Review rounds —
  // Communications is admin-only, so the page refuses the URL outright.
  await signIn(page, "dana@greenroom.dev");
  await page.goto(COMMS);

  await expect(page).not.toHaveURL(/\/communications/);
  await expect(page.getByRole("heading", { name: "Communications" })).toHaveCount(0);
});

test("a hand-added speaker is writable-to, and a reviewer never is", async ({ page }) => {
  // decisions.md D-051 + ./recipients.ts: who the composer may write to is a
  // different set from who this event's log is about. Both halves are checked
  // here because each one has failed on its own — the roster row was missing
  // from the recipient derivation, and reviewers were in it.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS);

  await page.getByRole("button", { name: "Add speaker" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByLabel("Name", { exact: true }).fill(MARISOL);
  await addDialog.getByLabel("Email", { exact: true }).fill(MARISOL_EMAIL);
  await addDialog.getByLabel("Company (optional)").fill(MARISOL_COMPANY);
  await addDialog.getByRole("button", { name: "Add speaker" }).click();
  await expect(page.getByText(`${MARISOL} was added to the roster`)).toBeVisible();

  await page.goto(COMMS);
  await openTab(page, "Compose");

  // She holds nothing on the programme, so `event_speakers` is the only thing
  // that can put her in the picker — and it does.
  await expect(
    page.getByRole("listitem").filter({ hasText: MARISOL_EMAIL }).getByRole("checkbox"),
  ).toBeVisible();

  // Dana reviews for this event, so the log knows her (D-050). The composer
  // still must not list her: from the picker she is one "All speakers" chip
  // away from a message written for the lineup.
  await expect(page.getByRole("listitem").filter({ hasText: DANA })).toHaveCount(0);
  await page.getByLabel("Search recipients").fill("Okoye");
  await expect(page.getByText("Nobody here matches")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();

  // The contrast that makes the exclusion deliberate rather than a lookup
  // failure: the same name *is* offered by the log's speaker filter, because
  // that set is "everyone this event's mail concerns".
  await openTab(page, "Log");
  await page.getByLabel("Filter by speaker").click();
  await expect(page.getByRole("option", { name: DANA })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the composer previews with the first picked recipient's own details", async ({ page }) => {
  // decisions.md D-053: a preview that shows a different person's name than
  // the send will use is a lie the organizer only catches after sending.
  // Unique per run, so the assertions can't match copy left by another test.
  const marker = `green room notes ${Date.now().toString(36)}`;

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);
  await openTab(page, "Compose");

  await page.locator("#compose-subject").fill(`Arrival details — ${marker}`);
  await page.locator("#compose-body").fill(`Hi {{speakerFirstName}}, ${marker}`);

  // Nobody picked yet: the sample person stands in, which is honest — no
  // recipient has been chosen (templatePreviewData's "Priya").
  await expect(page.getByText(`Hi Priya, ${marker}`)).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: HANNAH_EMAIL })
    .getByRole("checkbox")
    .click();

  // Picked: the preview is now what Hannah would actually receive, and the
  // sample name is gone rather than sitting alongside it.
  await expect(page.getByText(`Hi Hannah, ${marker}`)).toBeVisible();
  await expect(page.getByText(`Hi Priya, ${marker}`)).toHaveCount(0);

  // Read-only on purpose: the draft is ready to go, and this test doesn't
  // send it — the send path is already covered by the one-off message test.
  await expect(page.getByRole("button", { name: /^Send to 1 person$/ })).toBeEnabled();
});
