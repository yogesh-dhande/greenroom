import { expect, test, type Page } from "@playwright/test";
import { readdir, readFile, stat } from "node:fs/promises";
import { signIn } from "./helpers";

/**
 * Key flow: review, decide, and the acceptance conversion (spec.md §4, §5).
 *
 * A reviewer sees only the tracks they own and records a recommendation; an
 * admin turns a proposal into a session plus onboarding tasks with one click
 * and the speaker really gets told; a decline sends its own notice. Runs
 * against the seeded demo database.
 *
 * Tests run in file order on one worker and build on each other's state, but
 * each one reaches its submission through the queue rather than a shared URL —
 * a worker restart after a failure would wipe module state and turn one real
 * failure into six.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const SUBMISSIONS = `/admin/${EVENT_SLUG}/submissions`;

/** Seeded "submitted" talk in AI Engineering — Dana's track. Its speaker
 * (Jae-won Park) has no accepted talk, so acceptance has to create every
 * onboarding assignment from scratch. */
const PROMPT_LIBRARY = "What we learned rewriting our prompt library as code";
const PROMPT_LIBRARY_SPEAKER = "jw.park@example.com";
/** Also AI Engineering, and the one we decline. */
const STREAMING = "Streaming UIs that don't lie to the user";
const STREAMING_SPEAKER = "l.fernandez@example.com";
/** Agents & Tool Use — Marco's track, invisible to Dana. */
const MULTI_AGENT = "Multi-agent systems: when they help and when they're theatre";

/** The review queue's link to one submission. */
function queueLink(page: Page, title: string) {
  return page.getByRole("link", { name: title });
}

/** Opens a submission's detail page the way an organizer does: from the queue. */
async function openSubmission(page: Page, title: string): Promise<void> {
  await page.goto(SUBMISSIONS);
  await queueLink(page, title).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Messages the dev transport has written since `since` (mtime, not count:
 * the transport reuses filenames across runs). */
async function devEmailsSince(since: number): Promise<string[]> {
  const files = await readdir(".dev-emails").catch(() => [] as string[]);
  const bodies = await Promise.all(
    files
      .filter((name) => name.endsWith(".txt"))
      .map(async (name) => {
        const path = `.dev-emails/${name}`;
        const info = await stat(path);
        return info.mtimeMs >= since ? readFile(path, "utf8") : "";
      }),
  );
  return bodies.filter(Boolean);
}

/** Runs a decision from the detail page and waits for it to land. */
async function decide(page: Page, action: "Accept" | "Waitlist" | "Decline", note: string) {
  await page.locator("#decision-note").fill(note);
  await page.getByRole("button", { name: action, exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: `Confirm ${action.toLowerCase()}` }).click();
  await expect(confirm).toHaveCount(0);
}

test("the admin queue lists every submission, with filters and review activity", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SUBMISSIONS);

  // Every track, every status — the admin's view is the whole event.
  for (const title of [PROMPT_LIBRARY, STREAMING, MULTI_AGENT]) {
    await expect(queueLink(page, title)).toBeVisible();
  }

  // The seeded review on the multi-agent talk shows without opening it.
  await expect(page.getByRole("row", { name: MULTI_AGENT })).toContainText("1 maybe");

  // Filtering narrows the table and says so. Status is a row of count chips
  // (W25) — the chip carries its count in its accessible name.
  await page
    .getByRole("group", { name: "Filter by status" })
    .getByRole("button", { name: /^Denied/ })
    .click();
  await expect(page).toHaveURL(/status=denied/);
  await expect(page.getByText(/of \d+ submissions/)).toBeVisible();
  await expect(page.getByRole("link", { name: PROMPT_LIBRARY })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: PROMPT_LIBRARY })).toBeVisible();
});

test("a reviewer only sees the tracks they own", async ({ page }) => {
  // Grab the out-of-track talk's URL as the admin, so we can try it as Dana.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SUBMISSIONS);
  const forbidden = new URL(
    (await queueLink(page, MULTI_AGENT).getAttribute("href"))!,
    page.url(),
  ).pathname;

  await signIn(page, "dana@greenroom.dev");
  await page.goto(SUBMISSIONS);

  // Dana reviews AI Engineering and Evals & Reliability, not Agents & Tool Use.
  await expect(queueLink(page, PROMPT_LIBRARY)).toBeVisible();
  await expect(queueLink(page, MULTI_AGENT)).toHaveCount(0);

  // And routing isn't just a filter on the list: the page itself is closed.
  const response = await page.goto(forbidden);
  expect(response?.status()).toBe(404);
});

test("a reviewer records a recommendation, and the tally updates", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

  // The full proposal is here, rendered from the form's own fields.
  await expect(page.getByRole("heading", { name: PROMPT_LIBRARY })).toBeVisible();
  await expect(page.getByText("Prompts drifted across six teams")).toBeVisible();
  await expect(page.getByTestId("review-tally")).toContainText("No reviews yet");

  await page.getByRole("button", { name: "Approve" }).click();
  await page.locator("#review-comment").fill("Exactly the migration story our audience asks for.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("Review saved")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("review-tally")).toContainText("1 review: 1 approve");
  await expect(page.getByRole("button", { name: "Approve" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // It reads as a note from a named person, not an anonymous number. (The
  // comment is also still in the textarea, hence the paragraph filter.)
  await expect(page.getByText("Dana Okoye")).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Exactly the migration story" }),
  ).toBeVisible();

  // The queue shows the same tally.
  await page.goto(SUBMISSIONS);
  await expect(page.getByRole("row", { name: PROMPT_LIBRARY })).toContainText("1 approve");
});

test("a reviewer cannot record the final decision", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

  await expect(page.getByText("An event admin records the final decision")).toBeVisible();
  for (const action of ["Accept", "Waitlist", "Decline"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(page.locator("#decision-note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  await expect(page.getByTestId("decision-summary")).toContainText("No decision recorded yet");
});

test("an admin accepts a talk: session, onboarding tasks, and the email", async ({ page }) => {
  const startedAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

  // The reviewer's recommendation is what the admin is deciding on top of.
  await expect(page.getByTestId("review-tally")).toContainText("1 approve");

  await decide(page, "Accept", "The committee loved the versioning section.");
  // The toast says what the accept actually did, not just that it happened.
  await expect(page.getByText(/session created, 6 tasks assigned, 1 email sent/)).toBeVisible();

  await page.reload();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByTestId("decision-summary")).toContainText("Accepted by Avery Chen");
  // Unscheduled on purpose: placing it is the agenda board's job (spec.md §9).
  await expect(page.getByTestId("decision-session")).toContainText(
    "not yet placed on the agenda",
  );
  // Every auto-assigned onboarding task, for the one speaker on the talk
  // (six of them in the seeded event).
  await expect(page.getByTestId("decision-tasks")).toContainText(
    "6 onboarding tasks assigned across 1 speaker",
  );

  // The session is really on the agenda board, waiting to be placed.
  await page.goto(`/admin/${EVENT_SLUG}/agenda`);
  await expect(page.getByTestId("unscheduled-tray")).toContainText(PROMPT_LIBRARY);

  // And the speaker was told, through the real transport.
  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const accepted = emails.filter((body) => body.includes(PROMPT_LIBRARY));
    expect(accepted.map((body) => body.match(/^To: (.+)$/m)?.[1])).toContain(
      PROMPT_LIBRARY_SPEAKER,
    );
    const mine = accepted.find((body) => body.includes(PROMPT_LIBRARY_SPEAKER))!;
    expect(mine).toContain("has been accepted");
    expect(mine).toContain("The committee loved the versioning section.");
    // The acceptance email carries the onboarding tasks it just created.
    expect(mine).toContain("Finalize bio & photos");
  }).toPass({ timeout: 15_000 });
});

test("accepting twice does not duplicate the session or the tasks", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

  await decide(page, "Accept", "The committee loved the versioning section.");

  await page.reload();
  await expect(page.getByTestId("decision-tasks")).toContainText("6 onboarding tasks");
  await page.goto(`/admin/${EVENT_SLUG}/agenda`);
  await expect(
    page.getByTestId("unscheduled-tray").locator("[data-session-id]").filter({
      hasText: PROMPT_LIBRARY,
    }),
  ).toHaveCount(1);
});

test("an admin asks the speaker for a change without deciding anything", async ({ page }) => {
  const startedAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, STREAMING);

  await page.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator("#change-request")
    .fill("Could you add the two or three things an attendee will be able to do afterwards?");
  await dialog.locator("#change-due").fill("2026-05-01");
  await dialog.getByRole("button", { name: "Send request" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Change request sent")).toBeVisible();

  // Asking for a change is not a decision: the status is untouched.
  await page.reload();
  await expect(page.getByText("Unreviewed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("decision-summary")).toContainText("No decision recorded yet");

  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const asked = emails.filter(
      (body) => body.includes(STREAMING) && body.includes(STREAMING_SPEAKER),
    );
    expect(asked.length, "change request in .dev-emails/").toBeGreaterThan(0);
    expect(asked[0]).toContain("need one thing from you");
    expect(asked[0]).toContain("an attendee will be able to do afterwards");
    expect(asked[0]).toContain("Please do it by");
  }).toPass({ timeout: 15_000 });
});

test("a declined talk gets its own notice, and no session", async ({ page }) => {
  const startedAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, STREAMING);

  await decide(page, "Decline", "Close call — the streaming track was oversubscribed this year.");

  await page.reload();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
  await expect(page.getByTestId("decision-summary")).toContainText("Declined by Avery Chen");
  await expect(page.getByTestId("decision-session")).toHaveCount(0);

  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const declined = emails.filter(
      (body) =>
        body.includes(STREAMING) &&
        body.includes(STREAMING_SPEAKER) &&
        body.includes("weren't able to find a place for it"),
    );
    expect(declined.length, "decline email in .dev-emails/").toBeGreaterThan(0);
    // The admin's personal note rides along in the decision email.
    expect(declined[0]).toContain("the streaming track was oversubscribed");
  }).toPass({ timeout: 15_000 });
});
