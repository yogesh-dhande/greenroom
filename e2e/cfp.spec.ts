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

// Runs last: it closes the form the earlier tests submit to.
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
