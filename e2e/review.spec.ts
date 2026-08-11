import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { devEmailsSince, signIn } from "./helpers";

/**
 * Key flow: review, decide, and the acceptance conversion (spec.md §4, §5).
 *
 * A reviewer sees only the tracks they own and evaluates explicit assignments
 * through scorecards; an admin turns a proposal into a session plus onboarding
 * tasks with one click and the speaker really gets told; a decline sends its
 * own notice. Runs against the seeded demo database.
 *
 * Stateful decision sequences live in a single test. No test consumes a
 * binding decision written by another test.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const SUBMISSIONS = `/admin/${EVENT_SLUG}/submissions`;

/** Seeded "submitted" talk in AI Engineering — Dana's track. Its speaker
 * (Jae-won Park) has no accepted talk, so acceptance has to create every
 * onboarding assignment from scratch. */
const PROMPT_LIBRARY = "What we learned rewriting our prompt library as code";
const PROMPT_LIBRARY_SPEAKER = "jw.park@example.com";
/** AI Engineering, assigned to Dana in the open first-pass round. */
const PRACTICAL_EVALS = "Evals you'll actually keep running";
/** Also AI Engineering, and the one we decline. */
const STREAMING = "Streaming UIs that don't lie to the user";
const STREAMING_SPEAKER = "l.fernandez@example.com";
/** Agents & Tool Use — Marco's track, invisible to Dana. */
const MULTI_AGENT = "Multi-agent systems: when they help and when they're theatre";

/** The review queue's link to one submission. */
function queueLink(page: Page, title: string) {
  return page.getByRole("link", { name: title });
}

/** Opens a submission's detail page the way an organizer does: from the queue.
 * A reviewer with active round assignments defaults to the assigned view
 * (D-066), so the track-scoped list is addressed explicitly. */
async function openSubmission(page: Page, title: string): Promise<void> {
  await page.goto(`${SUBMISSIONS}?view=all`);
  await queueLink(page, title).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Reads one Overview stat card's number by its exact title. */
async function statValue(page: Page, label: string): Promise<number> {
  const card = page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${label}$`) }),
  });
  return Number(await card.locator("p.tabular-nums").innerText());
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

  // Dana holds active round assignments, so she lands on the assigned view
  // (D-066) and widens to her full track list from there.
  await expect(page.getByRole("link", { name: /Your assigned talks/ })).toBeVisible();
  await page.getByRole("link", { name: /All talks in your tracks/ }).click();

  // Dana reviews AI Engineering and Evals & Reliability, not Agents & Tool Use.
  await expect(queueLink(page, PROMPT_LIBRARY)).toBeVisible();
  await expect(queueLink(page, MULTI_AGENT)).toHaveCount(0);

  // And routing isn't just a filter on the list: the page itself is closed.
  const response = await page.goto(forbidden);
  expect(response?.status()).toBe(404);
});

test("reviewers use assigned scorecards and cannot flat-review unassigned talks", async ({
  page,
}) => {
  await signIn(page, "dana@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

  // Track routing still makes an unassigned proposal readable, but joining the
  // event's review plan removes the legacy recommendation controls.
  await expect(page.getByRole("heading", { name: PROMPT_LIBRARY })).toBeVisible();
  await expect(page.getByText("Prompts drifted across six teams")).toBeVisible();
  await expect(page.getByText("Your review", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Comment", { exact: true })).toHaveCount(0);
  for (const recommendation of ["Approve", "Maybe", "Deny"]) {
    await expect(page.getByRole("button", { name: recommendation, exact: true })).toHaveCount(0);
  }

  // Review authorization is separate from the binding decision: this
  // submitted, unassigned proposal has neither kind of reviewer control or
  // decision-status side channel while the review workspace is blind.
  await expect(page.getByText("An event admin records the final decision")).toBeVisible();
  for (const action of ["Accept", "Waitlist", "Decline"]) {
    await expect(page.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel("Note to the speakers", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  await expect(page.getByTestId("decision-summary")).toHaveCount(0);

  // Assigned work uses its round scorecard instead of the flat vocabulary.
  // This seeded proposal is already approved, so the assertions deliberately
  // cover only assignment authorization rather than assuming decision state.
  await openSubmission(page, PRACTICAL_EVALS);
  await expect(page.getByText("First-pass review", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Score this submission" })).toBeVisible();
  await expect(page.getByText("Your review", { exact: true })).toHaveCount(0);

  const acceptanceAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

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
    const emails = await devEmailsSince(acceptanceAt);
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
  // Repeating the command is idempotent: no second session or task set.
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

test("a change request preserves status before a later decline sends one decision", async ({ page }) => {
  const changeRequestAt = Date.now();

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
    const emails = await devEmailsSince(changeRequestAt);
    const asked = emails.filter(
      (body) => body.includes(STREAMING) && body.includes(STREAMING_SPEAKER),
    );
    expect(asked.length, "change request in .dev-emails/").toBeGreaterThan(0);
    expect(asked[0]).toContain("need one thing from you");
    expect(asked[0]).toContain("an attendee will be able to do afterwards");
    expect(asked[0]).toContain("Please do it by");
  }).toPass({ timeout: 15_000 });
  const declineAt = Date.now();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, STREAMING);

  await decide(page, "Decline", "Close call — the streaming track was oversubscribed this year.");

  await page.reload();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
  await expect(page.getByTestId("decision-summary")).toContainText("Declined by Avery Chen");
  await expect(page.getByTestId("decision-session")).toHaveCount(0);

  await expect(async () => {
    const emails = await devEmailsSince(declineAt);
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

test("an admin re-routes a talk into a reviewer's tracks, and her queue follows", async ({
  page,
}) => {
  // Routing lives on the record's Tracks card — the escape hatch for a talk
  // no reviewer can reach (a form without the reserved tracks question leaves
  // a submission with zero tracks, routed to nobody).
  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, MULTI_AGENT);

  const dialog = page.getByRole("dialog", { name: "Edit tracks" });
  await page.getByRole("button", { name: "Edit tracks" }).click();
  await dialog.getByRole("checkbox", { name: "AI Engineering" }).click();
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText("Tracks updated")).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Dana reviews AI Engineering, so the talk is now hers to see.
  await signIn(page, "dana@greenroom.dev");
  await page.goto(`${SUBMISSIONS}?view=all`);
  await expect(queueLink(page, MULTI_AGENT)).toBeVisible();

  // Put the routing back the way the seed had it; her view follows again.
  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, MULTI_AGENT);
  await page.getByRole("button", { name: "Edit tracks" }).click();
  await dialog.getByRole("checkbox", { name: "AI Engineering" }).click();
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await expect(dialog).toHaveCount(0);

  await signIn(page, "dana@greenroom.dev");
  await page.goto(`${SUBMISSIONS}?view=all`);
  await expect(queueLink(page, MULTI_AGENT)).toHaveCount(0);
});

test("a reviewer's overview stops at the submissions they can see", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}`);
  // Positive control: the admin gets the whole-event cards...
  await expect(
    page.locator('[data-slot="card-title"]', { hasText: /^Unscheduled sessions$/ }),
  ).toBeVisible();
  const adminSubmissions = await statValue(page, "Submissions");

  await signIn(page, "dana@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}`);

  // ...while the admin-only surfaces' numbers are gone for her, not zeroed.
  for (const label of ["Sessions", "Unscheduled sessions", "Speakers", "Tasks"]) {
    await expect(
      page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${label}$`) }),
    ).toHaveCount(0);
  }

  // And her submission count is the track-scoped queue, not the event's.
  const reviewerSubmissions = await statValue(page, "Submissions");
  expect(reviewerSubmissions).toBeGreaterThan(0);
  expect(reviewerSubmissions).toBeLessThan(adminSubmissions);
});
