import { createIsolatedForm, expect, publishForm, test } from "./fixtures";
import { devEmailsSince, signIn } from "./helpers";

/**
 * Key flow: the whole call-for-speakers loop (spec.md §2, §3).
 *
 * An admin builds and publishes a form, a logged-out visitor submits a talk
 * with a co-speaker and a headshot, the confirmation email really goes out,
 * the proposal shows up in the admin queue, and the submitter signs in and
 * edits it. Runs against the seeded demo database.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";

/** Seeded by scripts/seed.ts: closes in 30h, one proposal per speaker, and
 * carries an unfinished draft belonging to tom.beckett@example.com. */
const LIGHTNING_SLUG = "ai-engineer-summit-2026-lightning";
const LIGHTNING_DRAFT_TOKEN = "seed-draft-resume-lightning";

/** A tiny but valid PNG, so the upload exercises the real R2 path. */
const HEADSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("an isolated CFP runs from build through submission and speaker edit", async ({
  page,
  fixtureId,
}) => {
  const startedAt = Date.now();
  const formName = `CFP ${fixtureId}`;
  const title = `Talk ${fixtureId}`;
  const editedTitle = `Edited ${title}`;
  const speakerEmail = `${fixtureId}@example.com`;
  const coSpeakerEmail = `co-${fixtureId}@example.com`;

  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId, { name: formName });
  await expect(page.getByText("Talk title").first()).toBeVisible();
  await expect(page.getByText("Abstract").first()).toBeVisible();
  await expect(page.getByRole("switch", { name: "Allow co-speakers" })).toBeChecked();
  await publishForm(page, form);
  await expect(page.getByText("Open", { exact: true })).toBeVisible();

  // No sign-in anywhere in this test: the public CFP page is open to anyone.
  await page.context().clearCookies();
  await page.goto(form.publicPath);
  await expect(page.getByRole("heading", { name: formName })).toBeVisible();

  await page.getByLabel("Talk title").fill(title);
  await page
    .getByLabel("Abstract")
    .fill("What broke, what we measured, and the three changes that fixed it.");
  await page.getByLabel("AI Engineering").check();
  await page.getByLabel("Your name").fill("E2E Speaker");
  await page.getByLabel("Your email").fill(speakerEmail);
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
  await page.getByRole("group", { name: "Co-speaker 1" }).getByLabel("Email").fill(coSpeakerEmail);

  await page.getByRole("button", { name: "Submit proposal" }).click();

  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sign in to edit/ })).toBeVisible();

  const submissionUrl = `/portal/submissions/${new URL(page.url()).pathname.split("/").pop()}`;

  // The real confirmation email went out through src/domain/comms.ts — and so
  // did the co-speaker's copy.
  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const recipients = emails
      .filter((body) => body.includes(title))
      .map((body) => body.match(/^To: (.+)$/m)?.[1]);
    expect(recipients, "confirmation emails in .dev-emails/").toContain(speakerEmail);
    expect(recipients).toContain(coSpeakerEmail);
    const speakerCopy = emails.find(
      (body) => body.includes(title) && body.includes(`To: ${speakerEmail}`),
    );
    expect(speakerCopy).toContain("AI Engineer Summit 2026");
  }).toPass({ timeout: 15_000 });

  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByText(title)).toBeVisible();

  await signIn(page, speakerEmail);
  await page.goto(submissionUrl);

  // Prefilled from what was submitted, including the co-speaker row.
  await expect(page.getByLabel("Talk title")).toHaveValue(title);
  await expect(page.getByRole("group", { name: "Co-speaker 1" }).getByLabel("Email")).toHaveValue(coSpeakerEmail);

  await page.getByLabel("Talk title").fill(editedTitle);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your proposal has been updated")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Talk title")).toHaveValue(editedTitle);

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

test("required answers are enforced before anything is saved", async ({ page, fixtureId }) => {
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId);
  await publishForm(page, form);
  await page.context().clearCookies();
  await page.goto(form.publicPath);
  await page.getByRole("button", { name: "Submit proposal" }).click();

  await expect(page.getByText("Talk title is required")).toBeVisible();
  await expect(page).toHaveURL(form.publicPath);
});

test("a known unpublished form renders an honest closed state", async ({ page, fixtureId }) => {
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId);
  await page.context().clearCookies();
  const response = await page.goto(form.publicPath);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: form.name })).toBeVisible();
  await expect(page.getByText("This call for speakers isn't open")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit proposal" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /public program/ })).toBeVisible();
  await expect(page.getByText(/Submissions closed/)).toHaveCount(0);
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

test("an organizer can accept video pitches in one click", async ({ page, fixtureId }) => {
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId);

  await page.getByRole("button", { name: "Accept video pitches" }).click();
  await expect(page.getByText("Video pitch or talk recording").first()).toBeVisible();
  // Offered once: the form already has the question now.
  await expect(page.getByRole("button", { name: "Accept video pitches" })).toHaveCount(0);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Form saved")).toBeVisible();
  await publishForm(page, form);

  // It's a validated link on the public form, not free text.
  await page.context().clearCookies();
  await page.goto(form.publicPath);
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

test("a speaker saves a draft, gets a link, and finishes it later", async ({
  page,
  fixtureId,
}) => {
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId);
  await publishForm(page, form);
  await page.context().clearCookies();
  const startedAt = Date.now();
  const draftEmail = `${fixtureId}@example.com`;

  await page.goto(form.publicPath);
  await page.getByLabel("Talk title").fill("Half an idea about eval harnesses");
  await page.getByLabel("Your email").fill(draftEmail);

  // Required questions are still blank — that's the whole point of a draft.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/submit/${form.slug}/resume/[0-9a-f]{32}$`));
  await expect(page.getByText("Picking up where you left off")).toBeVisible();
  await expect(page.getByLabel("Talk title")).toHaveValue("Half an idea about eval harnesses");

  const resumePath = new URL(page.url()).pathname;

  // The link back really was emailed — that link *is* the authentication.
  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const mine = emails.filter((body) => body.includes(draftEmail));
    expect(mine.join("\n"), "draft link email in .dev-emails/").toContain(resumePath);
  }).toPass({ timeout: 15_000 });

  // If the same speaker returns signed in, the ordinary public form does not
  // silently hand them a second blank proposal. It points at this draft while
  // still allowing another submission when the form limit permits one.
  await signIn(page, draftEmail);
  await page.goto(form.publicPath);
  await expect(page.getByText("You have an unfinished draft of this proposal")).toBeVisible();
  const signedInResume = page.getByRole("link", { name: "pick up where you left off" });
  await expect(signedInResume).toBeVisible();
  await expect(signedInResume).toHaveAttribute("href", /\/portal\/submissions\//);
  await expect(page.getByRole("button", { name: "Submit proposal" })).toBeVisible();

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
  // proposal has not been offered to anyone yet. Dana is a real seeded
  // reviewer — the queue must actually render for her (positive control, so
  // the absence check below can't pass vacuously on an access refusal).
  await signIn(page, "dana@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByRole("heading", { name: "Submissions" })).toBeVisible();
  await expect(page.getByText("Untitled draft — five things that broke in prod")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Per-form submission limits (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("a two-proposal-per-speaker form turns the third attempt away", async ({
  page,
  fixtureId,
}) => {
  const speakerEmail = `${fixtureId}@example.com`;
  // The seeded lightning call allows two per speaker (D-046 headroom), so the
  // limit trips on the third attempt, not the second.
  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await page.getByLabel("Lightning talk title").fill("Five minutes on flaky retries");
  await page.getByLabel("What's the idea?").fill("The retry that made the outage worse.");
  await page.getByLabel("Your name").fill("E2E Lightning");
  await page.getByLabel("Your email").fill(speakerEmail);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();

  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await page.getByLabel("Lightning talk title").fill("Five more minutes");
  await page.getByLabel("What's the idea?").fill("The second idea, still within the limit.");
  await page.getByLabel("Your name").fill("E2E Lightning");
  await page.getByLabel("Your email").fill(speakerEmail);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();

  // Same address, third go: refused server-side, since a logged-out visitor
  // is only identifiable by what they type.
  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await page.getByLabel("Lightning talk title").fill("Another five minutes");
  await page.getByLabel("What's the idea?").fill("A third idea, one too many.");
  await page.getByLabel("Your name").fill("E2E Lightning");
  await page.getByLabel("Your email").fill(speakerEmail);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  // The refusal shows twice — inline alert and toast — so pick the alert.
  await expect(
    page.getByRole("alert").filter({ hasText: /accepts up to 2 proposals per speaker/ }),
  ).toBeVisible();

  // And a speaker we can already identify never sees the form at all.
  await signIn(page, speakerEmail);
  await page.goto(`/submit/${LIGHTNING_SLUG}`);
  await expect(page.getByText("You've used your proposals for this call")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit proposal" })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Co-speakers are never required (decisions.md D-034, D-038)
// ---------------------------------------------------------------------------

test("nothing in the builder can make co-speakers mandatory", async ({ page, fixtureId }) => {
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId);

  // Open the co-speaker question: it has no "must answer" switch to find.
  // The expand toggle's accessible name is "<label> <type> · built-in";
  // plain /Co-speakers/ would also match the move/remove icon buttons.
  await page.getByRole("button", { name: /Co-speakers ·/ }).click();
  await expect(page.getByText("Co-speakers are never required")).toBeVisible();
  await expect(page.getByLabel("Speakers must answer this")).toHaveCount(0);

  // And a solo speaker sails past it on the public form.
  await publishForm(page, form);
  await page.context().clearCookies();
  await page.goto(form.publicPath);
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

test("an admin enters a proposal on a speaker's behalf", async ({ page, fixtureId }) => {
  const title = `Admin-entered ${fixtureId}`;
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await page.getByRole("link", { name: "Add a submission" }).click();

  await page.getByRole("link", { name: "Lightning Talks (closing soon)" }).click();
  await page.getByLabel("Lightning talk title").fill(title);
  await page.getByLabel("What's the idea?").fill("Invited talk, entered by the organizer.");
  await page.getByLabel("Your name").fill("Invited Keynote");
  await page.getByLabel("Your email").fill(`${fixtureId}@example.com`);
  await page.getByRole("button", { name: "Add proposal" }).click();

  // Lands in the queue like any other proposal.
  await expect(page).toHaveURL(new RegExp(`/admin/${EVENT_SLUG}/submissions/[^/]+$`));
  await expect(
    page.getByRole("heading", { name: title }),
  ).toBeVisible();

  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByText(title)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Session-type forms (decisions.md D-041)
// ---------------------------------------------------------------------------

test("a session-type form turns a submission straight into a confirmed session", async ({
  page,
  fixtureId,
}) => {
  const title = `Direct session ${fixtureId}`;
  const email = `${fixtureId}@example.com`;
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId, { type: "session" });
  await publishForm(page, form);

  // No sign-in: the invited/sponsor form is public like any other CFP.
  await page.context().clearCookies();
  await page.goto(form.publicPath);
  await expect(page.getByRole("heading", { name: form.name })).toBeVisible();

  await page.getByLabel("Talk title").fill(title);
  await page
    .getByLabel("Abstract")
    .fill("The sponsor slot we agreed in April, written the way it should be printed.");
  await page.getByLabel("AI Engineering").check();
  await page.getByLabel("Your name").fill("E2E Invited Speaker");
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("Speaker biography").fill("Speaks in guaranteed sponsor sessions.");
  await page.getByRole("button", { name: "Submit proposal" }).click();

  // The speaker sees the ordinary confirmation — nothing about review.
  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // For the organizer it is already accepted, and says why it skipped review.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions?status=approved`);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Approved")).toBeVisible();
  await expect(row.getByText("Direct to session")).toBeVisible();

  // And it exists as a real session, confirmed but not yet placed on a day.
  await page.goto(`/admin/${EVENT_SLUG}/agenda`);
  await expect(
    page.getByTestId("unscheduled-tray").getByText(title),
  ).toBeVisible();

  // A reviewer never sees it: it was a session before anyone could vote on it.
  // Dana reviews the AI Engineering track, which is exactly where it landed —
  // and the seeded abstract in that track proves her queue really is loading.
  await signIn(page, "dana@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await expect(page.getByText("Retrieval that survives production traffic")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Closing the window.
// ---------------------------------------------------------------------------

test("a closed submission window shows a friendly closed page", async ({ page, fixtureId }) => {
  await signIn(page, "admin@greenroom.dev");
  const form = await createIsolatedForm(page, EVENT_SLUG, fixtureId);

  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Closes").fill("2020-01-01T17:00");
  await page.getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByText("Form published")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(form.publicPath);
  await expect(page.getByText("This call for speakers is closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit proposal" })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Form-builder fixes: an emailed resume link survives a slug rename (D-038),
// reserved built-in questions lock their answer type, and a form an
// onboarding task points at refuses deletion. Each test creates its own form
// — the closed form above and the seeded forms stay untouched.
// ---------------------------------------------------------------------------

/** Its own form, created and renamed here — renaming any seeded form's slug
 * would break the other specs that submit to it by slug. */
test("an emailed draft link still works after the organizer changes the form's link", async ({
  page,
  fixtureId,
}) => {
  const startedAt = Date.now();
  const formName = `Rename ${fixtureId}`;
  const slugBefore = `before-${fixtureId}`.slice(0, 64).replace(/-+$/g, "");
  const slugAfter = `after-${fixtureId}`.slice(0, 64).replace(/-+$/g, "");
  const draftEmail = `${fixtureId}@example.com`;
  const draftTitle = `Draft ${fixtureId}`;

  // --- a published, open form of our own -----------------------------------
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/forms`);
  await page.getByRole("button", { name: "New form" }).click();
  await page.getByLabel("Form name").fill(formName);
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByRole("heading", { name: formName })).toBeVisible();

  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Public link").fill(slugBefore);
  await page.getByLabel("Closes").fill("2027-12-31T17:00");
  await page.getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByText("Form published")).toBeVisible();

  // --- a visitor saves a draft on it, signed out ---------------------------
  await page.context().clearCookies();
  await page.goto(`/submit/${slugBefore}`);
  await page.getByLabel("Talk title").fill(draftTitle);
  await page.getByLabel("Your email").fill(draftEmail);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/submit/${slugBefore}/resume/[0-9a-f]{32}$`));

  // The link we test with is the one that actually landed in their inbox —
  // that link *is* the authentication (D-038), so it's the thing that has to
  // survive the rename, not the URL the browser happens to be sitting on.
  let emailedPath = "";
  await expect(async () => {
    const emails = await devEmailsSince(startedAt);
    const mine = emails.filter((body) => body.includes(draftEmail));
    const match = mine
      .join("\n")
      .match(new RegExp(`/submit/${slugBefore}/resume/[0-9a-f]{32}`));
    expect(match, "draft link email in .dev-emails/").not.toBeNull();
    emailedPath = match![0];
  }).toPass({ timeout: 15_000 });

  // --- the organizer changes the public link -------------------------------
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/forms`);
  await page.getByRole("link", { name: formName }).click();
  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Public link").fill(slugAfter);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Form saved")).toBeVisible();

  // The old address is genuinely gone for the form itself...
  const stale = await page.request.get(`/submit/${slugBefore}`);
  expect(stale.status()).toBe(404);

  // --- ...but the emailed resume link lands on the draft, not on a 404 -----
  await page.context().clearCookies();
  const response = await page.goto(emailedPath);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/submit/${slugAfter}/resume/[0-9a-f]{32}$`));
  await expect(page.getByText("Picking up where you left off")).toBeVisible();
  await expect(page.getByLabel("Talk title")).toHaveValue(draftTitle);
});

/** Its own form: the seeded "Call for Speakers 2026" has no speaker_email
 * field of its own (the public page injects one at render time), so the
 * built-in "Your email" question only exists in the builder on a form built
 * from DEFAULT_CFP_FIELDS. Nothing here is saved — the form is left exactly as
 * `createForm` made it. */
test("a built-in question's answer type is locked, a custom one's is not", async ({
  page,
  fixtureId,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await createIsolatedForm(page, EVENT_SLUG, fixtureId);

  // --- "Your email": one allowed type, so the picker is dead ---------------
  // The expand toggle's accessible name starts with the question's label and
  // carries its type and "built-in"; anchoring at the start keeps it off the
  // "Move Your email up" / "Remove Your email" icon buttons beside it.
  await page.getByRole("button", { name: /^Your email/ }).click();
  const lockedType = page.getByLabel("Answer type");
  await expect(lockedType).toContainText("Email address");
  await expect(lockedType).toBeDisabled();
  await expect(page.getByText(/Locked — this is a built-in question/)).toBeVisible();
  await expect(page.getByText(/so it stays "Email address"/)).toBeVisible();

  // Collapse it again so exactly one "Answer type" control is on the page.
  await page.getByRole("button", { name: /^Your email/ }).click();
  await expect(page.getByLabel("Answer type")).toHaveCount(0);

  // --- a custom question keeps the whole vocabulary ------------------------
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByRole("button", { name: /^New question Short text/ }).click();

  const customType = page.getByLabel("Answer type");
  await expect(customType).toBeEnabled();
  await customType.click();
  for (const label of [
    "Short text",
    "Long text",
    "Email address",
    "Link",
    "Choose one",
    "Choose any",
    "Checkbox",
    "File upload",
  ]) {
    await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
  }
  // Every selectable type and nothing else — no co-speakers repeater in here.
  await expect(page.getByRole("option")).toHaveCount(8);
  await page.keyboard.press("Escape");

  // Nothing is saved: the form stays as created, so no other spec inherits a
  // stray "New question".
});
