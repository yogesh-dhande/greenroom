import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: the public program (spec.md "Important / strongly desired") —
 * the speaker gallery, the schedule, and their chrome-less embed twins, all
 * unauthenticated. Runs against the seeded demo event.
 *
 * scripts/seed.ts no longer hardcodes the event's dates: it places the event
 * ~6 weeks out from whenever it's run (EVENT_DAY_1/2/3 = today+45/46/47),
 * because the public program reading like a stale archive would also break
 * the reminder job's own date logic. Nothing below hardcodes a date string
 * either — day 1 vs. day 2 is asserted by tab order (day tabs render in day
 * order), and session identity by title/speaker, never by a literal
 * "Jun 16"/"2026-06-16"-style match (see e2e/agenda.spec.ts's eventDayLabel
 * for the pattern this avoids needing). This also sidesteps a format
 * mismatch: the public schedule renders dates via the event-timezone-aware,
 * long-month formatters in src/lib/event-time.ts (e.g. "August 8, 2026"),
 * a different convention from the admin agenda's UTC short-month formatDay
 * ("Aug 8, 2026").
 *
 * Tests run in file order on one worker and build on each other's state.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const OVERVIEW = `/p/${EVENT_SLUG}`;
const SPEAKERS = `/p/${EVENT_SLUG}/speakers`;
const SCHEDULE = `/p/${EVENT_SLUG}/schedule`;
const EMBED_SPEAKERS = `/embed/${EVENT_SLUG}/speakers`;
const EMBED_SCHEDULE = `/embed/${EVENT_SLUG}/schedule`;

// The seeded, accepted-and-scheduled talk (agenda.spec.ts's fixture too): day
// 1, 10:00, Main Stage, speaker Priya Raman.
const RETRIEVAL = "Retrieval that survives production traffic";
const PRIYA = "Priya Raman";
// Day 1, 11:00, Community Hall.
const INFERENCE = "Cutting inference spend by 80% without touching quality";
// Day 2, 14:00, Main Stage.
const HOSPITAL = "Shipping an agent into a hospital";
// Confirmed, seeded unscheduled — used only for the gallery assertion below.
// Not used to test schedule exclusion: agenda.spec.ts places this one on the
// grid when the whole e2e suite runs in file order (agenda.spec.ts sorts
// before program.spec.ts alphabetically), so "still off the schedule" is
// asserted against "Hands-on: building a recovery loop for flaky agents"
// instead, which no other spec ever schedules.
const TOOL_SCHEMAS = "Tool schemas are your real prompt";
const DAMOLA = "Damola Oyelaran";

test("the event landing page is public and links to speakers and schedule", async ({ page }) => {
  const response = await page.goto(OVERVIEW);
  expect(response?.status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login/);

  await expect(page.getByRole("heading", { name: "AI Engineer Summit 2026" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View speakers" })).toHaveAttribute(
    "href",
    SPEAKERS,
  );
  await expect(page.getByRole("link", { name: "View schedule" })).toHaveAttribute(
    "href",
    SCHEDULE,
  );
});

test("an unknown event slug shows a friendly 404, not a crash", async ({ page }) => {
  const response = await page.goto("/p/no-such-event-at-all");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("We can't find that event")).toBeVisible();
});

test("the speaker gallery shows every confirmed speaker, scheduled or not", async ({ page }) => {
  const response = await page.goto(SPEAKERS);
  expect(response?.status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login/);

  // Scheduled and confirmed: on the schedule too.
  await expect(page.getByRole("heading", { name: PRIYA })).toBeVisible();
  await expect(page.getByText(RETRIEVAL)).toBeVisible();

  // Confirmed, and seeded unscheduled (whether or not another spec later
  // places it — see TOOL_SCHEMAS above): the gallery shows every confirmed
  // speaker regardless of scheduling, unlike the schedule.
  await expect(page.getByRole("heading", { name: DAMOLA })).toBeVisible();
  await expect(page.getByText(TOOL_SCHEMAS)).toBeVisible();
});

test("the schedule shows only confirmed, scheduled sessions, in time order", async ({ page }) => {
  const response = await page.goto(SCHEDULE);
  expect(response?.status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login/);

  // Day 1's tab is selected by default: the 10:00 talk appears before the
  // 11:00 one.
  const day1Tab = page.getByRole("tab").first();
  await expect(day1Tab).toHaveAttribute("aria-selected", "true");

  const day1Panel = page.getByRole("tabpanel");
  await expect(day1Panel.getByText(RETRIEVAL)).toBeVisible();
  await expect(day1Panel.getByText(INFERENCE)).toBeVisible();
  const day1Order = day1Panel.getByText(new RegExp(`${RETRIEVAL}|${INFERENCE}`));
  await expect(day1Order.first()).toHaveText(RETRIEVAL);

  // A confirmed talk that no other spec ever places on the agenda (unlike
  // Tool schemas / Evals, which agenda.spec.ts schedules when the whole
  // suite runs in file order) stays off the public schedule for good.
  await expect(page.getByText("Hands-on: building a recovery loop for flaky agents")).toHaveCount(
    0,
  );

  // Day 2 holds the third scheduled session, on its own tab.
  await page.getByRole("tab").nth(1).click();
  await expect(page.getByRole("tabpanel").getByText(HOSPITAL)).toBeVisible();
});

test("a declined talk's speaker never appears in the public program", async ({ page }) => {
  const title = "A talk that will not survive review";
  const speakerEmail = "e2e.program.decline@example.com";
  const speakerName = "Casey Program";

  // A fresh, self-contained submission — not seed data, so this never
  // touches what agenda.spec.ts/cfp.spec.ts/review.spec.ts rely on.
  await page.goto(`/submit/${EVENT_SLUG}`);
  await page.getByLabel("Talk title").fill(title);
  await page
    .getByLabel("Abstract")
    .fill("This talk exists only to prove a cancelled session never becomes public.");
  await page.getByLabel("AI Engineering").check();
  // The seeded main CFP (unlike the blank form cfp.spec.ts builds from
  // scratch) also asks for a format and a code-of-conduct acknowledgement.
  await page.getByLabel("Session format").click();
  await page.getByRole("option", { name: "30-minute talk" }).click();
  await page.getByLabel("Your name").fill(speakerName);
  await page.getByLabel("Your email").fill(speakerEmail);
  await page.getByLabel("Speaker biography").fill("Speaks only in end-to-end tests.");
  await page.getByLabel("I agree to the code of conduct").check();
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page).toHaveURL(/\/submit\/.+\/thanks\/.+/);

  // Accept it: this is the moment the gallery/schedule domain logic has to
  // exclude — a confirmed, unscheduled session, exactly like Tool schemas.
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Confirm accept" }).click();
  await expect(page.getByTestId("decision-summary")).toContainText("Accepted");

  await page.goto(SPEAKERS);
  await expect(page.getByText(speakerName)).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();

  // Reverse it: spec.md/D-025 §4 — this cancels the session, never deletes
  // it, and a cancelled session is never publicly programmed.
  await page.goto(`/admin/${EVENT_SLUG}/submissions`);
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Decline" }).click();
  await page.getByRole("button", { name: "Confirm decline" }).click();
  await expect(page.getByTestId("decision-summary")).toContainText("Declined");

  await page.goto(SPEAKERS);
  await expect(page.getByText(speakerName)).toHaveCount(0);
  await expect(page.getByText(title)).toHaveCount(0);

  await page.goto(SCHEDULE);
  await expect(page.getByText(title)).toHaveCount(0);
});

test("the embed routes render the same program with no page chrome", async ({ page }) => {
  await page.goto(EMBED_SPEAKERS);
  await expect(page.getByRole("heading", { name: PRIYA })).toBeVisible();
  await expect(page.locator("nav")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Speakers" })).toHaveCount(0);

  await page.goto(EMBED_SCHEDULE);
  await expect(page.getByText(RETRIEVAL)).toBeVisible();
  await expect(page.locator("nav")).toHaveCount(0);
});

test("an unknown event slug in an embed shows a minimal not-found, not a crash", async ({
  page,
}) => {
  const response = await page.goto("/embed/no-such-event-at-all/speakers");
  expect(response?.status()).toBe(404);
});

test("the public program works on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SPEAKERS);
  await expect(page.getByRole("heading", { name: PRIYA })).toBeVisible();

  await page.goto(SCHEDULE);
  await expect(page.getByText(RETRIEVAL)).toBeVisible();
});
