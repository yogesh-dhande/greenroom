import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: multi-round scored evaluations (spec.md "Important", decisions.md
 * D-031).
 *
 * An organizer designs a round with all three criterion types, hands specific
 * submissions to one reviewer, and reads the aggregate back; the reviewer sees
 * exactly their own queue and nothing else. Runs against the seeded demo
 * database, which already contains two rounds of its own — this spec builds a
 * third, so "the reviewer's queue" can only be right if scoping is per round
 * rather than per person.
 *
 * Tests run in file order on one worker and build on each other's state, each
 * one navigating in from /rounds rather than a shared URL.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const ROUNDS = `/admin/${EVENT_SLUG}/rounds`;
const ROUND = "Playwright screening round";

/** Assigned in this round: talks no other spec decides on, all inside Dana's
 * tracks (AI Engineering + Evals & Reliability) — since the track-scoping fix,
 * an out-of-track talk's checkbox is disabled for her. */
const EVALS = "Evals you'll actually keep running";
const OFFLINE_EVALS = "Offline evals lied to us for a quarter";
const CONTEXT_BUDGET = "A field guide to context window budgeting";
/** Assigned to Dana in the *seeded* round — must not leak into this one. */
const RETRIEVAL = "Retrieval that survives production traffic";

/** "YYYY-MM-DDTHH:MM" for a datetime-local input, `days` from now. */
function localInput(days: number): string {
  const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(
    when.getHours(),
  )}:${pad(when.getMinutes())}`;
}

/** Picks a point on a segmented 1–5 criterion: since the W29 a11y fix the
 * radio input is an invisible overlay covering its segment, so it takes the
 * pointer hit directly; checking it afterwards proves it registered. */
async function pickPoint(page: Page, criterion: string, point: number): Promise<void> {
  await page.locator(`#criterion-${criterion}-${point}`).click();
  await expect(page.locator(`#criterion-${criterion}-${point}`)).toBeChecked();
}

/** The round's row in the list — every test starts from here. */
function roundRow(page: Page) {
  return page.getByRole("row", { name: ROUND });
}

async function openRoundTab(page: Page, tab: "Assign" | "Results"): Promise<void> {
  await page.goto(ROUNDS);
  await roundRow(page).getByRole("link", { name: tab }).click();
}

/** Dana's line in the round's reviewer-progress table. */
function danaProgress(page: Page) {
  return page.getByTestId("reviewer-progress-row").filter({ hasText: "Dana Okoye" });
}

/** Picks an option from a shadcn/Radix select by its label. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}

test("an organizer builds a round with ratings, a dropdown, and free text", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(ROUNDS);

  // The seeded plan already has two rounds — this is a third, independent one.
  await expect(page.getByRole("link", { name: "First-pass review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Committee final round" })).toBeVisible();

  await page.getByRole("link", { name: "New round" }).click();
  await page.locator("#round-name").fill(ROUND);
  await page.locator("#round-opens").fill(localInput(-7));
  await page.locator("#round-closes").fill(localInput(30));

  // Rating one: weighted double, so weighting is visible in the aggregate.
  await page.locator("#criterion-label-0").fill("Originality");
  await page.locator("#criterion-weight-0").fill("2");

  await page.getByRole("button", { name: "Add rating" }).click();
  await page.locator("#criterion-label-1").fill("Relevance");

  await page.getByRole("button", { name: "Add dropdown" }).click();
  await page.locator("#criterion-label-2").fill("Recommendation");
  await page.locator("#criterion-options-2").fill("Accept, Maybe, Decline");

  await page.getByRole("button", { name: "Add free text" }).click();
  await page.locator("#criterion-label-3").fill("Comments");

  await page.getByRole("button", { name: "Create round" }).click();
  await expect(page.getByText("Round created")).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/[^/]+\/assignments/);

  // It survives a reload: the round and its scorecard are really stored.
  await page.goto(ROUNDS);
  await roundRow(page).getByRole("link", { name: ROUND }).click();
  await expect(page.locator("#round-name")).toHaveValue(ROUND);
  await expect(page.locator("#criterion-label-0")).toHaveValue("Originality");
  await expect(page.locator("#criterion-weight-0")).toHaveValue("2");
  await expect(page.locator("#criterion-options-2")).toHaveValue("Accept, Maybe, Decline");
  await expect(page.locator("#criterion-label-3")).toHaveValue("Comments");
});

test("an organizer assigns specific submissions to one reviewer", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await openRoundTab(page, "Assign");

  await choose(page, "Reviewer", "Dana Okoye");
  for (const title of [EVALS, OFFLINE_EVALS, CONTEXT_BUDGET]) {
    await page.getByLabel(`Select ${title}`).click();
  }
  await page.getByRole("button", { name: /Assign selected to Dana Okoye/ }).click();
  await expect(page.getByText("Assigned to Dana Okoye")).toBeVisible();

  // The organizer can see who holds what, and the round's own reviewer pool.
  for (const title of [EVALS, OFFLINE_EVALS, CONTEXT_BUDGET]) {
    await expect(page.getByRole("row", { name: title })).toContainText("Dana Okoye");
  }
  await expect(page.getByRole("row", { name: RETRIEVAL })).toContainText("Nobody yet");
  await expect(danaProgress(page)).toContainText("0 of 3 scored");
});

test("a reviewer's queue is exactly what they were assigned in this round", async ({ page }) => {
  // Grab an id Dana holds in the *seeded* round, to try it in this one.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  const forbiddenId = new URL(
    (await page.getByRole("link", { name: RETRIEVAL }).getAttribute("href"))!,
    page.url(),
  ).pathname
    .split("/")
    .pop()!;
  await page.goto(ROUNDS);
  const roundHref = (await roundRow(page).getByRole("link", { name: "Assign" }).getAttribute(
    "href",
  ))!;
  const roundBase = roundHref.replace("/assignments", "");

  await signIn(page, "dana@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page).getByRole("link", { name: "Open queue" }).click();

  await expect(page.getByTestId("queue-row")).toHaveCount(3);
  for (const title of [EVALS, OFFLINE_EVALS, CONTEXT_BUDGET]) {
    await expect(page.getByText(title)).toBeVisible();
  }
  // Dana reviews this one in another round — that doesn't put it in this queue.
  await expect(page.getByText(RETRIEVAL)).toHaveCount(0);

  // And the scoping isn't just the list: the page itself is closed.
  const response = await page.goto(`${roundBase}/score/${forbiddenId}`);
  expect(response?.status()).toBe(404);

  // Results are the organizer's view; a reviewer never sees the aggregate.
  const results = await page.goto(`${roundBase}/results`);
  expect(results?.url()).not.toContain("/results");
});

test("a reviewer fills in the scorecard, and their answers come back", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page).getByRole("link", { name: "Open queue" }).click();

  await page.getByRole("row", { name: EVALS }).getByRole("link", { name: "Score" }).click();
  await expect(page.getByRole("heading", { name: EVALS })).toBeVisible();
  // The proposal is in front of the reviewer, co-speakers and all.
  await expect(page.getByText("Hannah Kim")).toBeVisible();

  // Numeric criteria on a short integer scale render as segmented radios (W25).
  await pickPoint(page, "originality", 5);
  await pickPoint(page, "relevance", 3);
  await choose(page, "Recommendation", "Accept");
  await page.locator("#criterion-comments").fill("Keeps its promises; would open the track.");
  await page.getByRole("button", { name: "Submit scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();

  // Back on the queue, marked done — and the answers really persisted.
  await expect(page.getByRole("row", { name: EVALS })).toContainText("Submitted");
  await page.getByRole("row", { name: EVALS }).getByRole("link", { name: "Review scorecard" }).click();
  await expect(page.locator("#criterion-originality-5")).toBeChecked();
  await expect(page.locator("#criterion-relevance-3")).toBeChecked();
  await expect(page.getByLabel("Recommendation")).toContainText("Accept");
  await expect(page.locator("#criterion-comments")).toHaveValue(
    "Keeps its promises; would open the track.",
  );

  // A second, weaker scorecard so the results table has something to sort.
  await page.goto(ROUNDS);
  await roundRow(page).getByRole("link", { name: "Open queue" }).click();
  await page.getByRole("row", { name: OFFLINE_EVALS }).getByRole("link", { name: "Score" }).click();
  await pickPoint(page, "originality", 2);
  await pickPoint(page, "relevance", 2);
  await choose(page, "Recommendation", "Decline");
  await page.locator("#criterion-comments").fill("Covered better by the agents talk.");
  await page.getByRole("button", { name: "Submit scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();
});

test("the organizer sees progress, the aggregate, sorting, and a CSV export", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await openRoundTab(page, "Assign");
  await expect(danaProgress(page)).toContainText("2 of 3 scored");

  await openRoundTab(page, "Results");
  // Originality 5 (weight 2) and Relevance 3 on a 1–5 scale: (100·2 + 50)/3.
  await expect(page.getByRole("row", { name: EVALS })).toContainText("83.3");
  await expect(page.getByRole("row", { name: OFFLINE_EVALS })).toContainText("25");
  // Co-speakers and tracks travel with the row (spec.md §2).
  await expect(page.getByRole("row", { name: EVALS })).toContainText("Hannah Kim");

  // Highest first by default; sorting by the aggregate flips it.
  await expect(page.getByTestId("result-row").first()).toContainText(EVALS);
  await page.getByRole("button", { name: "Sort by Aggregate score" }).click();
  await expect(page.getByTestId("result-row").first()).toContainText(OFFLINE_EVALS);
  // Unscored submissions stay at the bottom in either direction.
  await expect(page.getByTestId("result-row").last()).toContainText(CONTEXT_BUDGET);

  const csvHref = (await page.getByRole("link", { name: "Download CSV" }).getAttribute("href"))!;
  const download = await page.request.get(csvHref);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("text/csv");
  expect(download.headers()["content-disposition"]).toContain(".csv");
  const csv = await download.text();
  const [header, ...rows] = csv.trim().split("\n");
  // Dropdown and free-text criteria each get a column after the averages —
  // the export is the only place unscored answers reach a spreadsheet.
  expect(header).toBe(
    "Submission,Speakers,Tracks,Status,Reviewers assigned,Scorecards submitted,Aggregate score,Originality (avg),Relevance (avg),Recommendation,Comments",
  );
  const evalsRow = rows.find((row) => row.includes(EVALS))!;
  expect(evalsRow).toContain("Hannah Kim");
  expect(evalsRow).toContain("83.3");
  expect(evalsRow.endsWith(",5,3,Accept,Keeps its promises; would open the track.")).toBe(true);
});

test("a reviewer can declare a conflict, and the organizer sees it", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page).getByRole("link", { name: "Open queue" }).click();
  await page.getByRole("row", { name: CONTEXT_BUDGET }).getByRole("link", { name: "Score" }).click();

  await page.getByRole("button", { name: "Declare a conflict of interest" }).click();
  await page.locator("#recusal-reason").fill("I manage the speaker.");
  await page.getByRole("button", { name: "Recuse me from this submission" }).click();
  await expect(page.getByText("Conflict recorded")).toBeVisible();
  await expect(page.getByRole("row", { name: CONTEXT_BUDGET })).toContainText("Recused");

  await signIn(page, "admin@greenroom.dev");
  await openRoundTab(page, "Assign");
  await expect(danaProgress(page)).toContainText("I manage the speaker.");
  // The recusal leaves her queue complete rather than permanently behind.
  await expect(danaProgress(page)).toContainText("2 of 2 scored");
});
