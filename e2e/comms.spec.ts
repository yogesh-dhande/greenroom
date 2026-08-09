import { expect, test, type Page } from "@playwright/test";
import { readdir, readFile, stat } from "node:fs/promises";
import { signIn } from "./helpers";

/**
 * Key flow: communications (spec.md §7) — the per-speaker log, one-off
 * messages with merge fields, per-event template wording, calendar invites,
 * and the deadline-reminder cadence (questions.md Q4).
 *
 * Every assertion that matters checks the *email*, not just the toast: mail
 * that renders in the UI but never leaves the building is the failure mode
 * this screen exists to prevent. The dev transport writes each message to
 * `.dev-emails/`, so a test can read exactly what a speaker would receive.
 *
 * Tests run in file order on one worker and build on each other's state.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const COMMS = `/admin/${EVENT_SLUG}/communications`;

const PRIYA = "Priya Raman";
const PRIYA_EMAIL = "priya.raman@example.com";
/** Seeded, scheduled, on Main Stage with Priya speaking — invitable. */
const RETRIEVAL = "Retrieval that survives production traffic";

/** Transcripts the dev transport wrote since `since` (mtime in ms). */
async function devEmailsSince(since: number, extension = ".txt"): Promise<string[]> {
  const files = await readdir(".dev-emails").catch(() => [] as string[]);
  const bodies = await Promise.all(
    files
      .filter((name) => name.endsWith(extension))
      .map(async (name) => {
        const path = `.dev-emails/${name}`;
        const info = await stat(path);
        return info.mtimeMs >= since ? readFile(path, "utf8") : "";
      }),
  );
  return bodies.filter(Boolean);
}

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name }).click();
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

test("the log narrows to one speaker's correspondence", async ({ page }) => {
  // Someone else's mail, seeded: a bounced calendar invite to a co-speaker.
  const OTHER = "l.fernandez@example.com";

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);

  await expect(page.getByRole("cell").filter({ hasText: OTHER })).toBeVisible();

  await page.getByLabel("Filter by speaker").click();
  await page.getByRole("option", { name: PRIYA }).click();

  await expect(page.getByRole("cell").filter({ hasText: PRIYA_EMAIL }).first()).toBeVisible();
  await expect(page.getByRole("cell").filter({ hasText: OTHER })).toHaveCount(0);

  // Both filters compose: her decisions only.
  await page.getByLabel("Filter by message type").click();
  await page.getByRole("option", { name: "Decision" }).click();
  await expect(page.getByRole("cell").filter({ hasText: "Decision" })).toHaveCount(1);
  await expect(page.getByRole("cell").filter({ hasText: "Submission received" })).toHaveCount(0);
});

test("a template edit with a bad merge field is refused, a good one sticks", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);
  await openTab(page, "Templates");

  await page.getByRole("button", { name: "Task / deadline reminder" }).click();
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
  await expect(page.getByText("Saved “Task / deadline reminder”")).toBeVisible();

  await page.reload();
  await openTab(page, "Templates");
  await page.getByRole("button", { name: "Task / deadline reminder" }).click();
  await expect(page.locator("textarea[id^='body-']")).toHaveValue(/Our team is around all week/);
  await expect(page.getByText("Edited")).toBeVisible();
});

test("a reminder run sends once, then respects the three-day cooldown", async ({ page }) => {
  const startedAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);

  await page.getByRole("button", { name: "Send reminders now" }).click();
  // The seed leaves outstanding tasks due within the week, so the first run
  // has something to do.
  await expect(page.getByText(/Sent \d+ reminders?/)).toBeVisible({ timeout: 30_000 });

  // The reminder used this event's saved wording from the previous test —
  // proof the override reaches the send path, not just the editor.
  await expect(async () => {
    const reminders = (await devEmailsSince(startedAt)).filter((body) =>
      body.includes("X-Greenroom-Log: task_reminder"),
    );
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders.some((body) => body.includes("Our team is around all week"))).toBe(true);
  }).toPass({ timeout: 20_000 });

  // Pressing it again immediately must be a no-op: idempotency comes from
  // email_log, so the first run's own rows suppress the second
  // (questions.md Q4 — at most one nudge per task every three days).
  const secondRunAt = Date.now();
  await page.getByRole("button", { name: "Send reminders now" }).click();
  await expect(page.getByText("No reminders needed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/reminded in the last few days/)).toBeVisible();

  const afterSecond = (await devEmailsSince(secondRunAt)).filter((body) =>
    body.includes("X-Greenroom-Log: task_reminder"),
  );
  expect(afterSecond).toHaveLength(0);
});

test("a calendar invitation goes out as a real .ics, and re-sending updates it", async ({
  page,
}) => {
  const startedAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await page.goto(COMMS);
  await openTab(page, "Calendar invites");

  const row = page.getByRole("listitem").filter({ hasText: RETRIEVAL });
  await row.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(/Invitation sent to \d+ speakers?/)).toBeVisible({
    timeout: 30_000,
  });

  await expect(async () => {
    const invites = (await devEmailsSince(startedAt, ".ics")).filter((ics) =>
      ics.includes(RETRIEVAL),
    );
    expect(invites.length).toBeGreaterThan(0);
    const ics = invites[0];
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toMatch(/^UID:session-.+$/m);
  }).toPass({ timeout: 20_000 });

  // Re-sending is the room-change story (decisions.md D-020): same UID, higher
  // SEQUENCE, so the speaker's existing calendar entry updates in place
  // instead of a second one appearing.
  const resendAt = Date.now();
  await page.reload();
  await openTab(page, "Calendar invites");
  await expect(row.getByText(/invites? sent/)).toBeVisible();
  await row.getByRole("button", { name: "Re-send invitation" }).click();
  await expect(page.getByText(/Updated invitation sent/)).toBeVisible({ timeout: 30_000 });

  await expect(async () => {
    const invites = (await devEmailsSince(resendAt, ".ics")).filter((ics) =>
      ics.includes(RETRIEVAL),
    );
    expect(invites.length).toBeGreaterThan(0);
    expect(invites[0]).toContain("SEQUENCE:1");
  }).toPass({ timeout: 20_000 });
});

test("a reviewer can read the log but cannot send anything", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await page.goto(COMMS);

  await expect(page.getByRole("heading", { name: "Communications" })).toBeVisible();
  await expect(page.getByLabel("Filter by speaker")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Compose" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send reminders now" })).toHaveCount(0);
});
