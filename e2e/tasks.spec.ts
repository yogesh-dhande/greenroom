import { expect, test, type Page } from "@playwright/test";
import { readdir, readFile, stat } from "node:fs/promises";
import { signIn } from "./helpers";

/**
 * Key flow: task assignment (spec.md §6, §8; decisions.md D-039, D-069) — the
 * one-time "new work landed on your checklist" email that a manual assignment
 * sends, and the shape lock that stops an assigned task being redefined under
 * the work already filed against it.
 *
 * Both tests assert the *email* and the *server's* refusal, not just the
 * toast: D-039 says a speaker gets exactly two kinds of task mail, and the
 * assignment notice is the one an organizer never sees go out.
 *
 * Every fixture here is its own — a fresh hand-added speaker (D-051) and
 * freshly created tasks, with auto-assign switched off. Seeded speakers and
 * the six seeded task templates are left exactly as other specs expect them.
 *
 * Each test creates the speaker and task records it mutates.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const TASKS = `/admin/${EVENT_SLUG}/tasks`;
const SPEAKERS = `/admin/${EVENT_SLUG}/speakers`;
const COMMS = `/admin/${EVENT_SLUG}/communications`;
const EVENT_NAME = "AI Engineer Summit 2026";

/** Two speakers added by hand for these tests only, so no seeded speaker's
 * task counts, digest eligibility, or completion meters move. */
const EMERIC = "Emeric Ashgrove";
const EMERIC_EMAIL = "emeric.ashgrove@example.com";
const LIORA = "Liora Vantreight";
const LIORA_EMAIL = "liora.vantreight@example.com";

/** Task templates created here; titles are distinctive so the seeded six (and
 * portal.spec's second "Invite colleagues…") are never matched by mistake. */
const BADGE_TASK = "Collect your speaker badge";
const VISA_TASK = "Visa letter request";
const SPARE_TASK = "Green room preferences";
const DUPLICATE_TASK = "Confirm backstage arrival window";

/** A seeded onboarding form (scripts/seed.ts) — used so the locked task has a
 * form to freeze as well as a type. */
const FLIGHT_FORM = "Flight Reimbursement";

/** Transcripts the dev transport wrote since `since` (mtime in ms). Same
 * reading as e2e/comms.spec.ts — a task email that renders in the UI but never
 * leaves the building is the failure mode these tests exist to catch. */
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

/** Puts a brand-new person on the roster (decisions.md D-051). Signed in as
 * an admin already. */
async function addSpeaker(page: Page, name: string, email: string): Promise<void> {
  await page.goto(SPEAKERS);
  await page.getByRole("button", { name: "Add speaker" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByRole("button", { name: "Add speaker" }).click();
  await expect(page.getByText(`${name} was added to the roster`)).toBeVisible();
}

test("assigning a task emails the speaker once, and never again on a re-save", async ({ page }) => {
  const startedAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await addSpeaker(page, EMERIC, EMERIC_EMAIL);

  await page.goto(TASKS);
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(BADGE_TASK);
  await dialog
    .getByLabel("Instructions (optional)")
    .fill("Pick your badge up at the speaker desk before your first session.");
  // Auto-assign off, so this fixture can't change the "6 tasks assigned" count
  // review.spec checks when it accepts a talk (the same reason portal.spec
  // switches it off on the task it creates).
  await dialog.getByRole("switch", { name: "Auto-assign on acceptance" }).click();
  await dialog.getByLabel("Who gets this task").click();
  await page.getByRole("option", { name: "Specific speakers" }).click();
  await dialog.getByLabel(EMERIC).click();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText(/assigned to 1 speaker/)).toBeVisible();

  // It really went out: one message, addressed to her, listing only what was
  // just handed over — the standing checklist is the weekly digest's job
  // (decisions.md D-039).
  await expect(async () => {
    const mine = (await devEmailsSince(startedAt)).filter(
      (body) => body.includes("X-Greenroom-Log: task_assigned") && body.includes(EMERIC_EMAIL),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].match(/^To: (.+)$/m)?.[1]).toBe(EMERIC_EMAIL);
    expect(mine[0]).toContain(`New on your ${EVENT_NAME} speaker checklist`);
    expect(mine[0]).toContain(`- ${BADGE_TASK}`);
  }).toPass({ timeout: 20_000 });

  // And it's in the communication log, classified as its own kind rather than
  // folded into the digest's history (types.ts EMAIL_KIND_LABELS).
  await page.goto(COMMS);
  await page.getByLabel("Filter by speaker").click();
  await page.getByRole("option", { name: EMERIC }).click();
  await expect(page.locator(`td[title="${EMERIC_EMAIL}"]`)).toHaveCount(1);
  await expect(page.getByRole("cell").filter({ hasText: "Task assigned" })).toHaveCount(1);
  await expect(
    page.getByRole("cell").filter({ hasText: `New on your ${EVENT_NAME} speaker checklist` }),
  ).toHaveCount(1);
  // The log says what it was about, resolved from the assignment it links to.
  await expect(page.getByText("Onboarding task")).toBeVisible();

  // One-time means one time. Re-saving the task with the same person picked
  // adds no assignment (every assign path is idempotent, D-069) and so must
  // send nothing — an organizer re-running an action is not news.
  const resaveAt = Date.now();
  await page.goto(TASKS);
  await page.getByRole("button", { name: `Edit ${BADGE_TASK}` }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Who gets this task").click();
  await page.getByRole("option", { name: "Specific speakers" }).click();
  // She's ticked and can't be unticked: this dialog adds assignments, it never
  // deletes work.
  await expect(edit.getByLabel(EMERIC)).toBeDisabled();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/everyone you picked already had it/)).toBeVisible();

  const afterResave = (await devEmailsSince(resaveAt)).filter((body) =>
    body.includes("X-Greenroom-Log: task_assigned"),
  );
  expect(afterResave).toHaveLength(0);

  // The assignment is real work on her portal, not just a log row.
  await signIn(page, EMERIC_EMAIL);
  await page.goto("/portal");
  await expect(page.getByRole("group", { name: BADGE_TASK })).toBeVisible();
});

test("a task's shape locks once someone holds it; an unassigned one stays editable", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await addSpeaker(page, LIORA, LIORA_EMAIL);
  await page.goto(TASKS);

  // A form task, so both halves of "what this task is" — the type and the form
  // it collects — are on screen to freeze.
  await page.getByRole("button", { name: "New task" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(VISA_TASK);
  await dialog.getByLabel("Type", { exact: true }).click();
  await page.getByRole("option", { name: "Fill out a form" }).click();
  await dialog.getByLabel("Form", { exact: true }).click();
  await page.getByRole("option", { name: FLIGHT_FORM }).click();
  await dialog.getByRole("switch", { name: "Auto-assign on acceptance" }).click();
  await dialog.getByLabel("Who gets this task").click();
  await page.getByRole("option", { name: "Specific speakers" }).click();
  await dialog.getByLabel(LIORA).click();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText(/assigned to 1 speaker/)).toBeVisible();

  // Reopened: what it collects is fixed, and the dialog says so before the
  // organizer types — the server refuses the same change (tasks/actions.ts
  // updateTask), this is just the half that arrives in time to be useful.
  await page.getByRole("button", { name: `Edit ${VISA_TASK}` }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Form", { exact: true })).toBeDisabled();
  await expect(dialog.getByText("A speaker already has this task")).toBeVisible();
  await expect(dialog.getByText(/so its type and form are fixed/)).toBeVisible();
  await expect(dialog.getByText(/Create a new task to collect something different/)).toBeVisible();

  // The rest of the task is still an ordinary edit — the lock is on its shape,
  // not on the record.
  await expect(dialog.getByLabel("Title", { exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("Due (optional)")).toBeEnabled();
  await page.keyboard.press("Escape");

  // A task nobody holds has no filed work to strand, so it stays fully
  // editable — the lock is about assignments, not about age.
  await page.getByRole("button", { name: "New task" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(SPARE_TASK);
  await dialog.getByRole("switch", { name: "Auto-assign on acceptance" }).click();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("cell", { name: SPARE_TASK, exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Edit ${SPARE_TASK}` }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Type", { exact: true })).toBeEnabled();
  await expect(dialog.getByText(/so its type and form are fixed/)).toHaveCount(0);

  // And the change actually goes through, server side too.
  await dialog.getByLabel("Type", { exact: true }).click();
  await page.getByRole("option", { name: "Upload a file" }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("row").filter({ hasText: SPARE_TASK })).toContainText(
    "Upload a file",
  );
});

test("an exact duplicate task is blocked by default and requires an explicit override", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(TASKS);

  await page.getByRole("button", { name: "New task" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(DUPLICATE_TASK);
  await expect(dialog.getByLabel("Create it anyway")).not.toBeChecked();
  await dialog.getByRole("button", { name: "Create task" }).click();
  const duplicateRows = page.locator("tbody tr").filter({ hasText: DUPLICATE_TASK });
  await expect(duplicateRows).toHaveCount(1);

  await page.getByRole("button", { name: "New task" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(DUPLICATE_TASK);
  await expect(dialog.getByLabel("Create it anyway")).not.toBeChecked();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(
    dialog.getByText(
      "A task with this title, type, and due date already exists. Tick ‘Create it anyway’ if a second copy is intentional.",
    ),
  ).toBeVisible();
  await expect(duplicateRows).toHaveCount(1);

  await dialog.getByLabel("Create it anyway").check();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(duplicateRows).toHaveCount(2);
});
