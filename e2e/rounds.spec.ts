import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { devEmailsSince, signIn } from "./helpers";

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
 * The lifecycle is one scenario because every step intentionally consumes the
 * round created by the step before it. No separate test inherits that state.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const ROUNDS = `/admin/${EVENT_SLUG}/rounds`;

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
function roundRow(page: Page, roundName: string) {
  return page.getByRole("row", { name: roundName });
}

async function openRoundTab(
  page: Page,
  roundName: string,
  tab: "Assign" | "Results",
): Promise<void> {
  await page.goto(ROUNDS);
  await roundRow(page, roundName).getByRole("link", { name: tab }).click();
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

test("an isolated scored round runs from design through assignments, scoring, export, and recusal", async ({
  page,
  fixtureId,
}) => {
  const roundName = `Round ${fixtureId}`;
  await signIn(page, "admin@greenroom.dev");
  await page.goto(ROUNDS);

  // The seeded plan already has two rounds — this is a third, independent one.
  await expect(page.getByRole("link", { name: "First-pass review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Committee final round" })).toBeVisible();

  await page.getByRole("link", { name: "New round" }).click();
  await page.locator("#round-name").fill(roundName);
  await page.locator("#round-opens").fill(localInput(-7));
  await page.locator("#round-closes").fill(localInput(30));
  await page.getByRole("switch", { name: "Hide speaker identity" }).click();

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
  await roundRow(page, roundName).getByRole("link", { name: roundName }).click();
  await expect(page.locator("#round-name")).toHaveValue(roundName);
  await expect(page.locator("#criterion-label-0")).toHaveValue("Originality");
  await expect(page.locator("#criterion-weight-0")).toHaveValue("2");
  await expect(page.locator("#criterion-options-2")).toHaveValue("Accept, Maybe, Decline");
  await expect(page.locator("#criterion-label-3")).toHaveValue("Comments");
  await signIn(page, "admin@greenroom.dev");
  await openRoundTab(page, roundName, "Assign");

  await choose(page, "Reviewer", "Dana Okoye");
  // The controlled reviewer identity is the source for every bulk action —
  // the selector must not visually fall back to the first pool member while
  // the action labels point at Dana (eval backlog F4).
  await expect(page.getByLabel("Reviewer")).toContainText("Dana Okoye (dana@greenroom.dev)");
  await expect(page.getByRole("button", { name: "Assign all to Dana Okoye" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign selected to Dana Okoye" })).toBeVisible();
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

  const reminderAt = Date.now();
  await page.getByRole("button", { name: "Remind reviewers" }).click();
  const reminderDialog = page.getByRole("alertdialog");
  await expect(reminderDialog).toContainText(`Remind 1 reviewer in ${roundName}?`);
  await reminderDialog.getByRole("button", { name: "Send reminders" }).click();
  await expect(page.getByText("Reviewer reminders: 1 sent · 0 skipped")).toBeVisible();
  await expect(page.getByTestId("round-reminder-history")).toContainText("Last reminder sent");
  await expect(page.getByTestId("round-reminder-history")).toContainText("dana@greenroom.dev");
  await expect(async () => {
    const reminder = (await devEmailsSince(reminderAt)).find(
      (body) => body.includes("dana@greenroom.dev") && body.includes("X-Greenroom-Log: round_reminder"),
    );
    expect(reminder).toBeTruthy();
    expect(reminder).toContain(roundName);
    expect(reminder).toContain("3");
    expect(reminder).toContain("/score");
  }).toPass({ timeout: 15_000 });
  // Success survives the toast and a page reload, and the event communication
  // log names the exact round, recipient, status, and timestamp.
  await page.reload();
  await expect(page.getByTestId("round-reminder-history")).toContainText("Last reminder sent");
  await page.goto(`/admin/${EVENT_SLUG}/communications`);
  const reminderLogRow = page.getByRole("row").filter({ hasText: roundName });
  await expect(reminderLogRow).toContainText("Dana Okoye");
  await expect(reminderLogRow).toContainText("Reviewer reminder");
  await expect(reminderLogRow).toContainText("Sent");
  await expect(reminderLogRow.locator("time")).toHaveAttribute("datetime", /T/);
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
  const roundHref = (await roundRow(page, roundName).getByRole("link", { name: "Assign" }).getAttribute(
    "href",
  ))!;
  const roundBase = roundHref.replace("/assignments", "");

  await signIn(page, "dana@greenroom.dev");
  // Dana participates in a blind round on this event. The wider track queue
  // must not become a side door around it: even rows not assigned in this
  // round keep every author hidden (D-084).
  await page.goto(`/admin/${EVENT_SLUG}/submissions?view=all`);
  await expect(page.locator("aside nav").getByRole("link")).toHaveText([
    "Overview",
    "Submissions",
    "Review rounds",
  ]);
  const trackQueueRows = page.locator("tbody tr");
  expect(await trackQueueRows.count()).toBeGreaterThan(3);
  for (const row of await trackQueueRows.all()) {
    await expect(row).toContainText("Speaker identity hidden for blind review");
  }
  await expect(page.getByText("Priya Raman")).toHaveCount(0);

  // The seeded accepted proposal has a speaker-facing decision note. It used
  // to leak "Priya" on this reviewer-visible record even though the proposal
  // answers themselves were blind.
  await page.goto(`/admin/${EVENT_SLUG}/submissions/${forbiddenId}`);
  await expect(page.getByText("Speaker identity hidden for blind review")).toBeVisible();
  await expect(
    page.getByText("Strong practitioner story, exactly the level our audience wants."),
  ).toHaveCount(0);
  await expect(page.getByText("Priya Raman")).toHaveCount(0);
  // Blindness covers the binding decision too. Its status, deciding admin,
  // conversion side effects, and speaker-facing note can all reveal context
  // that biases the reviewer; none belongs in this event-wide blind record.
  await expect(page.getByTestId("decision-summary")).toHaveCount(0);
  await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Accepted by Avery Chen/)).toHaveCount(0);
  await expect(page.getByText("What this decision did")).toHaveCount(0);
  await expect(page.getByTestId("decision-session")).toHaveCount(0);
  await expect(page.getByTestId("decision-tasks")).toHaveCount(0);
  await expect(page.getByTestId("decision-bar")).toContainText(
    "An event admin records the final decision",
  );

  // The organizer reads the same stored record without anonymization: the
  // decision status, actor, note, session, and onboarding outcome all remain.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions/${forbiddenId}`);
  await expect(page.getByTestId("decision-summary")).toContainText("Accepted by Avery Chen");
  await expect(page.getByText("What this decision did")).toBeVisible();
  await expect(page.getByText("Note to speakers:", { exact: true }).locator("..")).toContainText(
    "Strong practitioner story, exactly the level our audience wants.",
  );
  await expect(page.getByTestId("decision-session")).toBeVisible();
  await expect(page.getByTestId("decision-tasks")).toBeVisible();

  await signIn(page, "dana@greenroom.dev");

  await page.goto(ROUNDS);
  await roundRow(page, roundName).getByRole("link", { name: "Open queue" }).click();

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
  await signIn(page, "dana@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page, roundName).getByRole("link", { name: "Open queue" }).click();

  await page.getByRole("row", { name: EVALS }).getByRole("link", { name: "Score" }).click();
  await expect(page.getByRole("heading", { name: EVALS })).toBeVisible();
  // The proposal stays judgeable while every author clue is withheld.
  await expect(page.getByText("Blind review", { exact: true })).toBeVisible();
  await expect(page.getByText("Speaker identity hidden for blind review")).toBeVisible();
  await expect(page.getByText("Hannah Kim")).toHaveCount(0);
  await expect(page.getByText("hannah.kim@example.com")).toHaveCount(0);

  // Numeric criteria on a short integer scale render as segmented radios (W25).
  await pickPoint(page, "originality", 5);
  await pickPoint(page, "relevance", 3);
  await choose(page, "Recommendation", "Accept");
  await page.locator("#criterion-comments").fill("Keeps its promises; would open the track.");
  await page.getByRole("button", { name: "Submit scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();

  // Back on the queue, marked done — and the answers really persisted.
  await expect(page.getByRole("row", { name: EVALS })).toContainText("Submitted");
  const evalsSubmissionId = new URL(
    (await page
      .getByRole("row", { name: EVALS })
      .getByRole("link", { name: "Review scorecard" })
      .getAttribute("href"))!,
    page.url(),
  ).pathname
    .split("/")
    .pop()!;
  await page.goto(`/admin/${EVENT_SLUG}/submissions/${evalsSubmissionId}`);
  await expect(page.getByText("No reviewer has weighed in yet.")).toHaveCount(0);
  // Other independently isolated tests may have already filed a scorecard on
  // this seeded proposal. The contract is that this record acknowledges the
  // reviewer's filed round work instead of claiming nobody reviewed it; the
  // aggregate count is deliberately allowed to grow across the full suite.
  await expect(
    page.getByText(/\d+ round scorecards? filed in your assigned round/),
  ).toBeVisible();
  // This proposal is still undecided, but the neutral reviewer guidance is
  // identical to the accepted record above: no decided-vs-undecided side
  // channel survives the event-wide blind treatment.
  await expect(page.getByTestId("decision-summary")).toHaveCount(0);
  await expect(page.getByTestId("decision-bar")).toContainText(
    "An event admin records the final decision",
  );

  await page.goto(ROUNDS);
  await roundRow(page, roundName).getByRole("link", { name: "Open queue" }).click();
  await page.getByRole("row", { name: EVALS }).getByRole("link", { name: "Review scorecard" }).click();
  await expect(page.locator("#criterion-originality-5")).toBeChecked();
  await expect(page.locator("#criterion-relevance-3")).toBeChecked();
  await expect(page.getByLabel("Recommendation")).toContainText("Accept");
  await expect(page.locator("#criterion-comments")).toHaveValue(
    "Keeps its promises; would open the track.",
  );

  // A second, weaker scorecard so the results table has something to sort.
  await page.goto(ROUNDS);
  await roundRow(page, roundName).getByRole("link", { name: "Open queue" }).click();
  await page.getByRole("row", { name: OFFLINE_EVALS }).getByRole("link", { name: "Score" }).click();
  await pickPoint(page, "originality", 2);
  await pickPoint(page, "relevance", 2);
  await choose(page, "Recommendation", "Decline");
  await page.locator("#criterion-comments").fill("Covered better by the agents talk.");
  await page.getByRole("button", { name: "Submit scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();
  await signIn(page, "admin@greenroom.dev");
  await openRoundTab(page, roundName, "Assign");
  await expect(danaProgress(page)).toContainText("2 of 3 scored");

  await openRoundTab(page, roundName, "Results");
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
  await signIn(page, "dana@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page, roundName).getByRole("link", { name: "Open queue" }).click();
  await page.getByRole("row", { name: CONTEXT_BUDGET }).getByRole("link", { name: "Score" }).click();

  await page.getByRole("button", { name: "Declare a conflict of interest" }).click();
  await page.locator("#recusal-reason").fill("I manage the speaker.");
  await page.getByRole("button", { name: "Recuse me from this submission" }).click();
  await expect(page.getByText("Conflict recorded")).toBeVisible();
  await expect(page.getByRole("row", { name: CONTEXT_BUDGET })).toContainText("Recused");

  await signIn(page, "admin@greenroom.dev");
  await openRoundTab(page, roundName, "Assign");
  await expect(danaProgress(page)).toContainText("I manage the speaker.");
  // The recusal leaves her queue complete rather than permanently behind.
  await expect(danaProgress(page)).toContainText("2 of 2 scored");

  // --- Removing a scored assignment destroys the scorecard, so it asks first.
  //
  // `round_scores.assignment_id` is `ON DELETE cascade`: unassigning a reviewer
  // who has filed a scorecard deletes it, irreversibly and with nothing left to
  // show it existed. The 2026-08-18 evaluation lost two scorecards exactly this
  // way and read the empty results page as "scores don't save" (D-095).
  const removeEvals = page.getByRole("button", { name: `Unassign Dana Okoye from ${EVALS}` });
  await removeEvals.click();

  const warning = page.getByRole("alertdialog");
  await expect(warning).toContainText("Delete Dana Okoye’s scorecard?");
  await expect(warning).toContainText(EVALS);
  await expect(warning).toContainText("cannot be undone");

  // Backing out keeps both the assignment and the score.
  await warning.getByRole("button", { name: "Keep it" }).click();
  await expect(warning).toBeHidden();
  await expect(danaProgress(page)).toContainText("2 of 2 scored");
  await openRoundTab(page, roundName, "Results");
  await expect(page.getByRole("row", { name: EVALS })).toContainText("83.3");

  // Confirming really does remove both — that is what the warning promised.
  await openRoundTab(page, roundName, "Assign");
  await removeEvals.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete scorecard" }).click();
  await expect(page.getByText("Assignment and scorecard removed")).toBeVisible();
  await expect(danaProgress(page)).toContainText("1 of 1 scored");
});
