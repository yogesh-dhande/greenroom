import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Three fixes to the review-rounds feature, each covered end to end:
 *
 *  1. **Track-scoped round assignment** (D-035(1), D-060, D-061) — a reviewer
 *     may only be handed submissions their tracks cover. The picker says so on
 *     the row that can't be ticked, and the server refuses the bulk path.
 *  2. **Criteria lock** (D-060, the lock pattern from D-042) — once a scorecard
 *     is on file the round's criteria freeze, so filed answers read back
 *     against the questions they were given to.
 *  3. **Acceptance-reversal cleanup** — reversing an accept stands the session
 *     down *and* takes back the onboarding work that accept handed out, on both
 *     the organizer's and the speaker's side. Completed work survives (D-060's
 *     "work already done is never destroyed" reading).
 *
 * Every test is self-contained: it creates the round it needs, or restores the
 * seeded state it borrowed, so a single seeded run stays valid for the specs
 * that follow. File name matters — it must sort *after* e2e/review.spec.ts,
 * whose acceptance test asserts the first-ever accept of PROMPT_LIBRARY.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const ROUNDS = `/admin/${EVENT_SLUG}/rounds`;
const SUBMISSIONS = `/admin/${EVENT_SLUG}/submissions`;

// --- seeded submissions, by the track that routes them --------------------
/** Agents & Tool Use only — Marco's track, out of reach for Dana. */
const TOOL_SCHEMAS = "Tool schemas are your real prompt";
/** Evals & Reliability — Dana's, and touched by no other spec. */
const OFFLINE_EVALS = "Offline evals lied to us for a quarter";
/** Evals & Reliability — Dana's; scored here in a round of this file's own. */
const EVALS = "Evals you'll actually keep running";

// --- the reversal subject --------------------------------------------------
/** AI Engineering, "submitted". Its speaker holds no other accepted talk, so
 * a reversal really has to clear every onboarding assignment rather than
 * leaving them owed for a second session. */
const PROMPT_LIBRARY = "What we learned rewriting our prompt library as code";
const PROMPT_LIBRARY_SPEAKER = "jw.park@example.com";
/** Same note e2e/review.spec.ts accepts with, so restoring is byte-faithful. */
const ACCEPT_NOTE = "The committee loved the versioning section.";

const HOTEL_TASK = "Hotel stay requirement form";
const FINALIZE_BIO_TASK = "Finalize bio & photos";
const ANNOUNCE_TASK = "Announce participation";

// ---------------------------------------------------------------------------
// Helpers (mirrors of the ones in e2e/rounds.spec.ts and e2e/review.spec.ts —
// drop the duplicates if these blocks are appended into those files instead)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DDTHH:MM" for a datetime-local input, `days` from now. */
function localInput(days: number): string {
  const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(
    when.getHours(),
  )}:${pad(when.getMinutes())}`;
}

/** Picks an option from a shadcn/Radix select by its label. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}

/** A round's row in the list at /rounds. */
function roundRow(page: Page, name: string) {
  return page.getByRole("row", { name });
}

/** Creates a round with one 1–5 rating criterion and returns nothing — the
 * form lands on the new round's assignments page by itself. */
async function createRound(page: Page, name: string, criterion: string): Promise<void> {
  await page.goto(ROUNDS);
  await page.getByRole("link", { name: "New round" }).click();
  await page.locator("#round-name").fill(name);
  await page.locator("#round-opens").fill(localInput(-7));
  await page.locator("#round-closes").fill(localInput(30));
  await page.locator("#criterion-label-0").fill(criterion);
  await page.getByRole("button", { name: "Create round" }).click();
  await expect(page.getByText("Round created")).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/[^/]+\/assignments/);
}

/** Picks a point on a segmented 1–5 criterion (the radio is an invisible
 * overlay over its segment since the W29 a11y fix). */
async function pickPoint(page: Page, criterion: string, point: number): Promise<void> {
  await page.locator(`#criterion-${criterion}-${point}`).click();
  await expect(page.locator(`#criterion-${criterion}-${point}`)).toBeChecked();
}

/** Opens a submission's detail page the way an organizer does: from the queue.
 * `?view=all` because a reviewer with assignments defaults elsewhere (D-066). */
async function openSubmission(page: Page, title: string): Promise<void> {
  await page.goto(`${SUBMISSIONS}?view=all`);
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Runs a decision from the detail page and waits for it to land. */
async function decide(page: Page, action: "Accept" | "Decline", note: string): Promise<void> {
  await page.locator("#decision-note").fill(note);
  await page.getByRole("button", { name: action, exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: `Confirm ${action.toLowerCase()}` }).click();
  await expect(confirm).toHaveCount(0);
}

/** One card on the speaker portal, by its exact card title. */
function portalCard(page: Page, title: string) {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title}$`) }),
  });
}

/** A portal task's disclosure row, labelled by its title. */
function taskRegion(page: Page, title: string) {
  return page.getByRole("group", { name: title });
}

/** Tasks start collapsed (only the next-due one opens itself). */
async function openTask(page: Page, title: string) {
  const region = taskRegion(page, title);
  const trigger = region.locator("button[aria-expanded]").first();
  if ((await trigger.getAttribute("aria-expanded")) === "false") {
    await trigger.click();
  }
  return region;
}

// ---------------------------------------------------------------------------
// 1. Track-scoped round assignment (D-061)
// ---------------------------------------------------------------------------

test("a round can only hand a reviewer submissions their tracks cover", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  // Its own round, so ticking and assigning here can't disturb the seeded
  // plan the other round specs read.
  await createRound(page, "E2E track-scope round", "Fit");

  await choose(page, "Reviewer", "Dana Okoye");

  // Dana owns AI Engineering and Evals & Reliability. An Agents & Tool Use
  // talk isn't hers to be given: the row can't be ticked, and it says why
  // rather than just going grey.
  const outOfTrack = page.getByRole("checkbox", {
    name: `${TOOL_SCHEMAS} is outside Dana Okoye's tracks`,
  });
  await expect(outOfTrack).toBeDisabled();
  await expect(page.getByRole("row", { name: TOOL_SCHEMAS })).toContainText(
    "Outside Dana Okoye's tracks",
  );
  // The picker also says how much she *can* review, before anything is ticked.
  await expect(page.getByText(/Nothing ticked yet — of \d+ Dana Okoye can review\./)).toBeVisible();

  // One of her own tracks is selectable and really assignable.
  await page.getByLabel(`Select ${OFFLINE_EVALS}`).click();
  await page.getByRole("button", { name: /Assign selected to Dana Okoye/ }).click();
  await expect(page.getByText("Assigned to Dana Okoye")).toBeVisible();
  await expect(page.getByRole("row", { name: OFFLINE_EVALS })).toContainText("Dana Okoye");
  await expect(
    page.getByTestId("reviewer-progress-row").filter({ hasText: "Dana Okoye" }),
  ).toContainText("0 of 1 scored");

  // It's the reviewer's tracks doing the work, not a property of the row:
  // for Marco (Agents & Tool Use) the two swap over.
  await choose(page, "Reviewer", "Marco Silva");
  await expect(page.getByLabel(`Select ${TOOL_SCHEMAS}`)).toBeEnabled();
  await expect(
    page.getByRole("checkbox", { name: `${OFFLINE_EVALS} is outside Marco Silva's tracks` }),
  ).toBeDisabled();

  // And the picker is not the control: the bulk path is refused server-side.
  // Marco owns no AI Engineering talk, and none of that track's submissions
  // reaches him through a second track either.
  await choose(page, "Assign a whole track", "AI Engineering");
  await page.getByRole("button", { name: "Assign all" }).click();
  await expect(
    page.getByText("A reviewer can only be given submissions their tracks cover"),
  ).toBeVisible();
  // Nothing landed on him: Dana's assignment stands untouched, and Marco has
  // no progress row — only reviewers holding assignments get one. (The talk's
  // own row can't carry this assertion: its disabled-reason cell names Marco
  // while he's the selected reviewer.)
  await expect(page.getByRole("row", { name: OFFLINE_EVALS })).toContainText("Dana Okoye");
  await expect(
    page.getByTestId("reviewer-progress-row").filter({ hasText: "Marco Silva" }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 2. Criteria lock (D-060)
// ---------------------------------------------------------------------------

test("a round with scorecards on file shows its criteria locked, one without stays editable", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");

  // "First-pass review" is seeded mid-flight: three scorecards are already
  // filed against it, so its questions are frozen.
  await page.goto(ROUNDS);
  await roundRow(page, "First-pass review").getByRole("link", { name: "First-pass review" }).click();
  await expect(page.getByText(/Reviewers have already filed scorecards in this round/)).toBeVisible();
  await expect(page.locator("#criterion-label-0")).toBeDisabled();
  await expect(page.locator("#criterion-weight-0")).toBeDisabled();
  await expect(page.locator("#criterion-min-0")).toBeDisabled();
  await expect(page.locator("#criterion-options-2")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove Originality" })).toBeDisabled();
  // Only the scorecard is frozen — the round is still a round.
  for (const name of ["Add rating", "Add dropdown", "Add free text"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(page.locator("#round-name")).toBeEnabled();
  await expect(page.locator("#round-closes")).toBeEnabled();

  // "Committee final round" is seeded with assignments but nothing scored, so
  // its scorecard is still the organizer's to change.
  await page.goto(ROUNDS);
  await roundRow(page, "Committee final round")
    .getByRole("link", { name: "Committee final round" })
    .click();
  await expect(page.getByText(/Reviewers have already filed scorecards/)).toHaveCount(0);
  await expect(page.locator("#criterion-label-0")).toBeEnabled();
  await expect(page.locator("#criterion-weight-0")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Add rating" })).toBeVisible();
});

test("filing the first scorecard locks that round's criteria", async ({ page }) => {
  // Three sign-ins and a full design/assign/score pass.
  test.slow();

  await signIn(page, "admin@greenroom.dev");
  await createRound(page, "E2E criteria-lock round", "Craft");

  // Before anyone scores it, the scorecard is editable.
  await page.goto(ROUNDS);
  await roundRow(page, "E2E criteria-lock round")
    .getByRole("link", { name: "E2E criteria-lock round" })
    .click();
  await expect(page.locator("#criterion-label-0")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Add rating" })).toBeVisible();

  // Hand one in-track submission to Dana…
  await page.goto(ROUNDS);
  await roundRow(page, "E2E criteria-lock round").getByRole("link", { name: "Assign" }).click();
  await choose(page, "Reviewer", "Dana Okoye");
  await page.getByLabel(`Select ${EVALS}`).click();
  await page.getByRole("button", { name: /Assign selected to Dana Okoye/ }).click();
  await expect(page.getByText("Assigned to Dana Okoye")).toBeVisible();

  // …and let her file the round's first scorecard.
  await signIn(page, "dana@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page, "E2E criteria-lock round").getByRole("link", { name: "Open queue" }).click();
  await page.getByRole("row", { name: EVALS }).getByRole("link", { name: "Score" }).click();
  await pickPoint(page, "craft", 4);
  await page.getByRole("button", { name: "Submit scorecard" }).click();
  await expect(page.getByText("Scorecard submitted")).toBeVisible();

  // The organizer's setup form is now read-only about the questions — and
  // says so, rather than letting them find out on save.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(ROUNDS);
  await roundRow(page, "E2E criteria-lock round")
    .getByRole("link", { name: "E2E criteria-lock round" })
    .click();
  await expect(page.getByText(/so the scorecard is locked/)).toBeVisible();
  await expect(page.locator("#criterion-label-0")).toHaveValue("Craft");
  await expect(page.locator("#criterion-label-0")).toBeDisabled();
  await expect(page.locator("#criterion-weight-0")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add rating" })).toHaveCount(0);

  // Everything else about the round still saves, with the criteria untouched.
  await page.locator("#round-description").fill("Locked scorecard, editable round.");
  await page.getByRole("button", { name: "Save round" }).click();
  await expect(page.getByText("Round saved")).toBeVisible();
  await page.goto(ROUNDS);
  await roundRow(page, "E2E criteria-lock round")
    .getByRole("link", { name: "E2E criteria-lock round" })
    .click();
  await expect(page.locator("#round-description")).toHaveValue("Locked scorecard, editable round.");
  await expect(page.locator("#criterion-label-0")).toHaveValue("Craft");
});

// ---------------------------------------------------------------------------
// 3. Acceptance-reversal cleanup
// ---------------------------------------------------------------------------

test("reversing an acceptance stands the session down and takes back the pending onboarding work", async ({
  page,
}) => {
  // Four sign-ins: accept, read the speaker's portal, reverse, read it again.
  test.slow();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);

  // Accepting is idempotent (e2e/review.spec.ts may have accepted this one
  // already), so this test states its own precondition rather than inheriting
  // it: a session, and every auto-on-accept task in the seed for its one
  // speaker.
  await decide(page, "Accept", ACCEPT_NOTE);
  await page.reload();
  await expect(page.getByTestId("decision-session")).toContainText("Session created");
  await expect(page.getByTestId("decision-tasks")).toContainText(
    "6 onboarding tasks assigned across 1 speaker",
  );

  // The speaker really holds the session and the work.
  await signIn(page, PROMPT_LIBRARY_SPEAKER);
  await page.goto("/portal");
  await expect(portalCard(page, "Your sessions")).toContainText(PROMPT_LIBRARY);
  await expect(taskRegion(page, HOTEL_TASK)).toBeVisible();
  await expect(taskRegion(page, FINALIZE_BIO_TASK)).toBeVisible();

  // Now the organizer changes their mind.
  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);
  await decide(page, "Decline", "Reversed — the track filled up after all.");
  await page.reload();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
  await expect(page.getByTestId("decision-summary")).toContainText("Declined by Avery Chen");
  // The session is stood down rather than deleted, so the change is visible…
  await expect(page.getByTestId("decision-session")).toContainText(
    "The session made from this talk has been cancelled",
  );
  // …and the onboarding the accept handed out is gone, not merely hidden.
  await expect(page.getByTestId("decision-tasks")).toHaveCount(0);

  // The speaker's own view agrees: no cancelled session listed as if it were
  // still on the programme, and no work still asked of them.
  await signIn(page, PROMPT_LIBRARY_SPEAKER);
  await page.goto("/portal");
  await expect(portalCard(page, "Your sessions")).toContainText("No sessions yet.");
  await expect(portalCard(page, "Your sessions")).not.toContainText(PROMPT_LIBRARY);
  await expect(taskRegion(page, HOTEL_TASK)).toHaveCount(0);
  await expect(taskRegion(page, FINALIZE_BIO_TASK)).toHaveCount(0);
  // The proposal itself is still theirs to see — only the acceptance was taken back.
  await expect(portalCard(page, "Your submissions")).toContainText(PROMPT_LIBRARY);

  // Put the seeded world back the way e2e/review.spec.ts left it: re-accepting
  // restores the same session row and re-issues the onboarding.
  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);
  await decide(page, "Accept", ACCEPT_NOTE);
  await page.reload();
  await expect(page.getByTestId("decision-session")).toContainText("Session created");
  await expect(page.getByTestId("decision-tasks")).toContainText("6 onboarding tasks");
});

test("a reversal never destroys onboarding work the speaker already did", async ({ page }) => {
  // D-060's other half: an assignment that was completed is a record of work
  // done, and reversing the decision that created it must not delete it.
  test.slow();

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);
  await decide(page, "Accept", ACCEPT_NOTE);

  // The speaker finishes one of the six before anything is reversed.
  await signIn(page, PROMPT_LIBRARY_SPEAKER);
  await page.goto("/portal");
  const announce = await openTask(page, ANNOUNCE_TASK);
  if (!((await announce.textContent())?.includes("Complete") ?? false)) {
    await announce.getByRole("button", { name: "Mark as done" }).click();
  }
  await expect(announce).toContainText("Complete");

  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);
  await decide(page, "Decline", "Reversed — checking that finished work survives.");
  await page.reload();
  // Exactly the completed one is left standing.
  await expect(page.getByTestId("decision-tasks")).toContainText(
    "1 onboarding task assigned across 1 speaker",
  );

  await signIn(page, PROMPT_LIBRARY_SPEAKER);
  await page.goto("/portal");
  await expect(taskRegion(page, ANNOUNCE_TASK)).toContainText("Complete");
  await expect(taskRegion(page, HOTEL_TASK)).toHaveCount(0);
  await expect(taskRegion(page, FINALIZE_BIO_TASK)).toHaveCount(0);

  // Restore: re-accepting re-issues only what's missing — the completed one
  // is left exactly as the speaker left it.
  await signIn(page, "admin@greenroom.dev");
  await openSubmission(page, PROMPT_LIBRARY);
  await decide(page, "Accept", ACCEPT_NOTE);
  await page.reload();
  await expect(page.getByTestId("decision-tasks")).toContainText("6 onboarding tasks");
});

// ---------------------------------------------------------------------------
// 4. The scorecard a viewer doesn't hold (eval backlog F4)
// ---------------------------------------------------------------------------

/**
 * Only an explicit assignment authorises scoring (D-089), so an organizer —
 * who never holds one — could not open a scorecard. That was correct, but the
 * answer was a bare 404, which reads as a broken link rather than a permission
 * boundary; organizers reach it by following an ordinary score link.
 *
 * The explanation is for organizers only. A reviewer still gets the 404, and
 * e2e/rounds.spec.ts pins that: in a blind round, naming the reviewers on a
 * submission — or even confirming the id sits in this round — is exactly what
 * the round withholds.
 */
test("an organizer opening a scorecard they don't hold is told why, not 404'd", async ({
  page,
}) => {
  const roundName = `Unassigned ${Date.now()}`;
  await signIn(page, "admin@greenroom.dev");
  await createRound(page, roundName, "Craft");

  const roundBase = new URL(page.url()).pathname.replace("/assignments", "");

  // Hand the submission to a reviewer, so the page has someone to name.
  await choose(page, "Reviewer", "Dana Okoye");
  await page.getByLabel(`Select ${OFFLINE_EVALS}`).click();
  await page.getByRole("button", { name: /Assign selected to Dana Okoye/ }).click();
  await expect(page.getByText("Assigned to Dana Okoye")).toBeVisible();

  // The submission id comes from the submissions list, not from this page: an
  // organizer holds no assignment, so the assignments table offers them no
  // score link at all — which is the very gap this test is about.
  await page.goto(SUBMISSIONS);
  const submissionId = new URL(
    (await page.getByRole("link", { name: OFFLINE_EVALS }).getAttribute("href"))!,
    page.url(),
  ).pathname
    .split("/")
    .pop()!;

  // The admin holds no assignment on it — and gets an explanation, not a 404.
  const response = await page.goto(`${roundBase}/score/${submissionId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Not your scorecard" })).toBeVisible();
  await expect(page.getByText("Assigned to Dana Okoye.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage assignments" })).toBeVisible();

  // It stays a permission boundary: no scorecard, and nothing about the
  // proposal itself leaks onto the page.
  await expect(page.getByRole("button", { name: "Submit scorecard" })).toHaveCount(0);
  await expect(page.getByText(OFFLINE_EVALS)).toHaveCount(0);

  // A reviewer without the assignment still gets the flat 404.
  await signIn(page, "marco@greenroom.dev");
  const reviewerResponse = await page.goto(`${roundBase}/score/${submissionId}`);
  expect(reviewerResponse?.status()).toBe(404);
});
