import { expect, test } from "@playwright/test";
import { readdir, readFile, stat } from "node:fs/promises";
import { signIn } from "./helpers";

/**
 * Key flow: the whole call-for-speakers loop (spec.md §2, §3).
 *
 * An admin builds and publishes a form, a logged-out visitor submits a talk
 * with a co-speaker and a headshot, the confirmation email really goes out,
 * the proposal shows up in the admin queue, and the submitter signs in and
 * edits it. Runs against the seeded demo database.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const FORM_NAME = "E2E Call for Speakers";
const FORM_SLUG = "e2e-call-for-speakers";
const TALK_TITLE = "Shipping retrieval that survives Black Friday";
const EDITED_TITLE = "Shipping retrieval that survives real traffic";
const SPEAKER_EMAIL = "e2e.speaker@example.com";
const CO_SPEAKER_EMAIL = "e2e.cospeaker@example.com";

/** Seeded by scripts/seed.ts: closes in 30h, one proposal per speaker, and
 * carries an unfinished draft belonging to tom.beckett@example.com. */
const LIGHTNING_SLUG = "ai-engineer-summit-2026-lightning";
const LIGHTNING_DRAFT_TOKEN = "seed-draft-resume-lightning";
const DRAFT_EMAIL = "e2e.drafter@example.com";

/** Set by the submission test, used by the edit test (one worker, in order). */
let submissionUrl = "";

/** A tiny but valid PNG, so the upload exercises the real R2 path. */
const HEADSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Messages the dev transport has written since `since`.
 *
 * Filenames are reused between runs (the transport numbers them per process),
 * so freshness is judged by mtime rather than by the file count.
 */
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

test("admin builds a call-for-speakers form and publishes it", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/forms`);

  // The seeded form's response count is shown without loading its submissions.
  await expect(page.getByRole("cell", { name: "Call for Speakers 2026" })).toBeVisible();

  await page.getByRole("button", { name: "New form" }).click();
  await page.getByLabel("Form name").fill(FORM_NAME);
  await page.getByRole("button", { name: "Create form" }).click();

  // A new form arrives as a working CFP, not a blank canvas.
  await expect(page).toHaveURL(new RegExp(`/admin/${EVENT_SLUG}/forms/[^/]+$`));
  await expect(page.getByRole("heading", { name: FORM_NAME })).toBeVisible();
  await expect(page.getByText("Talk title").first()).toBeVisible();
  await expect(page.getByText("Abstract").first()).toBeVisible();
  await expect(page.getByRole("switch", { name: "Allow co-speakers" })).toBeChecked();

  // Give it a predictable public link and an open window.
  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Public link").fill(FORM_SLUG);
  await page.getByLabel("Closes").fill("2027-12-31T17:00");

  await page.getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByText("Form published")).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
});

test("a visitor submits a talk with a co-speaker and gets a confirmation", async ({ page }) => {
  const startedAt = Date.now();

  // No sign-in anywhere in this test: the public CFP page is open to anyone.
  await page.goto(`/submit/${FORM_SLUG}`);
  await expect(page.getByRole("heading", { name: FORM_NAME })).toBeVisible();

  await page.getByLabel("Talk title").fill(TALK_TITLE);
  await page
    .getByLabel("Abstract")
    .fill("What broke, what we measured, and the three changes that fixed it.");
  await page.getByLabel("AI Engineering").check();
  await page.getByLabel("Your name").fill("E2E Speaker");
  await page.getByLabel("Your email").fill(SPEAKER_EMAIL);
  await page
    .getByLabel("Speaker biography")
    .fill("Builds retrieval systems, mostly at 3am during incidents.");
  await page.getByLabel("Headshot").setInputFiles({
    name: "headshot.png",
    mimeType: "image/png",
    buffer: HEADSHOT,
  });
  const uploaded = page.getByRole("link", { name: "headshot.png" });
  await expect(uploaded).toBeVisible();

  // The upload really is in R2 and really comes back out of /files/<key>.
  const fileUrl = await uploaded.getAttribute("href");
  const served = await page.request.get(fileUrl!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");

  // Co-speakers are optional, so they only exist once you ask for a row.
  await page.getByRole("button", { name: "Add a co-speaker" }).click();
  await page.getByRole("group", { name: "Co-speaker 1" }).getByLabel("Name").fill("E2E Co-speaker");
  await page.getByRole("group", { name: "Co-speaker 1" }).getByLabel("Email").fill(CO_SPEAKER_EMAIL);

  await page.getByRole("button", { name: "Submit proposal" }).click();

  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: TALK_TITLE })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in to edit/ })).toBeVisible();

  const thanksUrl = new URL(page.url());
  submissionUrl = `/portal/submissions/${thanksUrl.pathname.split("/").pop()}`;

  // The real confirmation email went out through src/domain/comms.ts — and so
  // did the co-speaker's copy.
  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const recipients = emails
      .filter((body) => body.includes(TALK_TITLE))
      .map((body) => body.match(/^To: (.+)$/m)?.[1]);
    expect(recipients, "confirmation emails in .dev-emails/").toContain(SPEAKER_EMAIL);
    expect(recipients).toContain(CO_SPEAKER_EMAIL);
  }).toPass({ timeout: 15_000 });
});

test("the proposal appears in the admin submissions queue", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByText(TALK_TITLE)).toBeVisible();
});

test("the submitter signs in and edits their own proposal", async ({ page }) => {
  expect(submissionUrl, "the submission test must run first").not.toEqual("");

  await signIn(page, SPEAKER_EMAIL);
  await page.goto(submissionUrl);

  // Prefilled from what was submitted, including the co-speaker row.
  await expect(page.getByLabel("Talk title")).toHaveValue(TALK_TITLE);
  await expect(page.getByRole("group", { name: "Co-speaker 1" }).getByLabel("Email")).toHaveValue(CO_SPEAKER_EMAIL);

  await page.getByLabel("Talk title").fill(EDITED_TITLE);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your proposal has been updated")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Talk title")).toHaveValue(EDITED_TITLE);
});

test("a stranger cannot open someone else's submission", async ({ page }) => {
  await signIn(page, "priya.raman@example.com");
  const response = await page.goto(submissionUrl);
  expect(response?.status()).toBe(404);
});

test("a conditional question appears and disappears as the answer changes", async ({ page }) => {
  // The seeded CFP asks for workshop requirements only when the format is a
  // workshop (spec.md §2 conditional logic, decisions.md D-009).
  await page.goto(`/submit/${EVENT_SLUG}`);
  await expect(page.getByLabel("Workshop requirements")).toHaveCount(0);

  await page.getByLabel("Session format").click();
  await page.getByRole("option", { name: "90-minute workshop" }).click();
  await expect(page.getByLabel("Workshop requirements")).toBeVisible();

  await page.getByLabel("Session format").click();
  await page.getByRole("option", { name: "30-minute talk" }).click();
  await expect(page.getByLabel("Workshop requirements")).toHaveCount(0);
});

test("required answers are enforced before anything is saved", async ({ page }) => {
  await page.goto(`/submit/${FORM_SLUG}`);
  await page.getByRole("button", { name: "Submit proposal" }).click();

  await expect(page.getByText("Talk title is required")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/submit/${FORM_SLUG}$`));
});

test("an unpublished form is invisible to the public", async ({ page }) => {
  const response = await page.goto(`/submit/${EVENT_SLUG}-av`);
  expect(response?.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Field length limits (spec.md §2, decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("a capped question counts down and refuses an over-long answer", async ({ page }) => {
  await page.goto(`/submit/${LIGHTNING_SLUG}`);

  const title = page.getByLabel("Lightning talk title");
  await title.fill("Five things that broke");
  // The cap is 60 characters, so the counter is on screen from the start.
  await expect(page.getByText(/\/ 60 characters/)).toBeVisible();

  await title.fill("x".repeat(75));
  await expect(page.getByText("15 characters over the 60 limit")).toBeVisible();

  await page.getByLabel("What's the idea?").fill("Short and to the point.");
  await page.getByLabel("Your name").fill("E2E Overlong");
  await page.getByLabel("Your email").fill("e2e.overlong@example.com");
  await page.getByRole("button", { name: "Submit proposal" }).click();

  // Refused in the browser and never saved — the same rule the server holds.
  await expect(
    page.getByText("Lightning talk title has to be 60 characters or fewer"),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/submit/${LIGHTNING_SLUG}$`));
});

// ---------------------------------------------------------------------------
// The video-link preset (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("an organizer can accept video pitches in one click", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/forms`);
  await page.getByRole("link", { name: FORM_NAME }).click();

  await page.getByRole("button", { name: "Accept video pitches" }).click();
  await expect(page.getByText("Video pitch or talk recording").first()).toBeVisible();
  // Offered once: the form already has the question now.
  await expect(page.getByRole("button", { name: "Accept video pitches" })).toHaveCount(0);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Form saved")).toBeVisible();

  // It's a validated link on the public form, not free text.
  await page.goto(`/submit/${FORM_SLUG}`);
  const video = page.getByLabel("Video pitch or talk recording");
  await expect(video).toBeVisible();
  await video.fill("my talk is on my laptop");
  await page.getByLabel("Talk title").fill("Pitched on camera");
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Enter a full link, starting with https://")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Save as draft and resume (spec.md §2, decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("a speaker saves a draft, gets a link, and finishes it later", async ({ page }) => {
  const startedAt = Date.now();

  await page.goto(`/submit/${FORM_SLUG}`);
  await page.getByLabel("Talk title").fill("Half an idea about eval harnesses");
  await page.getByLabel("Your email").fill(DRAFT_EMAIL);

  // Required questions are still blank — that's the whole point of a draft.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/submit/${FORM_SLUG}/resume/[0-9a-f]{32}$`));
  await expect(page.getByText("Picking up where you left off")).toBeVisible();
  await expect(page.getByLabel("Talk title")).toHaveValue("Half an idea about eval harnesses");

  const resumePath = new URL(page.url()).pathname;

  // The link back really was emailed — that link *is* the authentication.
  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const mine = emails.filter((body) => body.includes(DRAFT_EMAIL));
    expect(mine.join("\n"), "draft link email in .dev-emails/").toContain(resumePath);
  }).toPass({ timeout: 15_000 });

  // Coming back on a fresh visit — no session, no cookie, just the link.
  await page.context().clearCookies();
  await page.goto(resumePath);
  await expect(page.getByLabel("Talk title")).toHaveValue("Half an idea about eval harnesses");

  await page.getByLabel("Abstract").fill("Finished at last: what we measured and what we changed.");
  await page.getByLabel("AI Engineering").check();
  await page.getByLabel("Your name").fill("E2E Drafter");
  await page.getByLabel("Speaker biography").fill("Writes evals, eventually.");
  await page.getByRole("button", { name: "Submit proposal" }).click();

  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();

  // The token outlives the draft, so the link in the inbox still resolves.
  await page.goto(resumePath);
  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);
});

test("the emailed link is the only key a saved draft needs", async ({ page }) => {
  // The seeded draft belongs to Tom Beckett; nobody is signed in here.
  await page.goto(`/submit/${LIGHTNING_SLUG}/resume/${LIGHTNING_DRAFT_TOKEN}`);

  await expect(page.getByText("Picking up where you left off")).toBeVisible();
  await expect(page.getByLabel("Lightning talk title")).toHaveValue(
    "Untitled draft — five things that broke in prod",
  );
  // Identity comes from the submission's speaker record, not from the answers.
  await expect(page.getByLabel("Your email")).toHaveValue("tom.beckett@example.com");

  // A guessed token is simply not a page.
  const response = await page.goto(`/submit/${LIGHTNING_SLUG}/resume/not-a-real-token`);
  expect(response?.status()).toBe(404);
});

test("a draft is not offered to reviewers but is visible to admins", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions?status=draft`);
  await expect(page.getByText("Untitled draft — five things that broke in prod")).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // A reviewer's queue is what goes in front of the committee; an unfinished
  // proposal has not been offered to anyone yet.
  await signIn(page, "reviewer@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByText("Untitled draft — five things that broke in prod")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Per-form submission limits (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("a one-proposal-per-speaker form turns a second attempt away", async ({ page }) => {
  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await page.getByLabel("Lightning talk title").fill("Five minutes on flaky retries");
  await page.getByLabel("What's the idea?").fill("The retry that made the outage worse.");
  await page.getByLabel("Your name").fill("E2E Lightning");
  await page.getByLabel("Your email").fill("e2e.lightning@example.com");
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();

  // Same address, second go: refused server-side, since a logged-out visitor
  // is only identifiable by what they type.
  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await page.getByLabel("Lightning talk title").fill("Another five minutes");
  await page.getByLabel("What's the idea?").fill("A second idea, one too many.");
  await page.getByLabel("Your name").fill("E2E Lightning");
  await page.getByLabel("Your email").fill("e2e.lightning@example.com");
  await page.getByRole("button", { name: "Submit proposal" }).click();
  // The refusal shows twice — inline alert and toast — so pick the alert.
  await expect(
    page.getByRole("alert").filter({ hasText: /accepts one proposal per speaker/ }),
  ).toBeVisible();

  // And a speaker we can already identify never sees the form at all.
  await signIn(page, "e2e.lightning@example.com");
  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await expect(page.getByText("You've used your proposals for this call")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit proposal" })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Co-speakers are never required (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("nothing in the builder can make co-speakers mandatory", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/forms`);
  await page.getByRole("link", { name: FORM_NAME }).click();

  // Open the co-speaker question: it has no "must answer" switch to find.
  // The expand toggle's accessible name is "<label> <type> · built-in";
  // plain /Co-speakers/ would also match the move/remove icon buttons.
  await page.getByRole("button", { name: /Co-speakers ·/ }).click();
  await expect(page.getByText("Co-speakers are never required")).toBeVisible();
  await expect(page.getByLabel("Speakers must answer this")).toHaveCount(0);

  // And a solo speaker sails past it on the public form.
  await page.goto(`/submit/${FORM_SLUG}`);
  await expect(page.getByRole("button", { name: "Add a co-speaker" })).toBeVisible();
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Talk title is required")).toBeVisible();
  // No "required" complaint anywhere in the co-speakers block, even though
  // other questions are showing theirs.
  await expect(
    page.getByRole("group", { name: "Co-speakers" }).getByText(/required/i),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Entering a proposal for someone (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("an admin enters a proposal on a speaker's behalf", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await page.getByRole("link", { name: "Add a submission" }).click();

  await page.getByRole("link", { name: "Lightning Talks (closing soon)" }).click();
  await page.getByLabel("Lightning talk title").fill("The keynote we agreed in the hallway");
  await page.getByLabel("What's the idea?").fill("Invited talk, entered by the organizer.");
  await page.getByLabel("Your name").fill("Invited Keynote");
  await page.getByLabel("Your email").fill("e2e.invited@example.com");
  await page.getByRole("button", { name: "Add proposal" }).click();

  // Lands in the queue like any other proposal.
  await expect(page).toHaveURL(new RegExp(`/admin/${EVENT_SLUG}/submissions/[^/]+$`));
  await expect(
    page.getByRole("heading", { name: "The keynote we agreed in the hallway" }),
  ).toBeVisible();

  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByText("The keynote we agreed in the hallway")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Closing the window — runs last: it closes the form the earlier tests
// submit to.
// ---------------------------------------------------------------------------

test("a closed submission window shows a friendly closed page", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/forms`);
  await page.getByRole("link", { name: FORM_NAME }).click();

  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Closes").fill("2020-01-01T17:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Form saved")).toBeVisible();

  await page.goto(`/submit/${FORM_SLUG}`);
  await expect(page.getByText("This call for speakers is closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit proposal" })).toHaveCount(0);
});
