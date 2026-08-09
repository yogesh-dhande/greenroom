import { expect, test, type Page } from "@playwright/test";
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

// ---------------------------------------------------------------------------
// Public program depth (spec.md "Public program depth", decisions.md D-031):
// search, facets, detail views, and the personal itinerary. Everything below
// is unauthenticated — no signIn() anywhere.
//
// Counts are asserted relatively ("3 of 5"), never absolutely: agenda.spec.ts
// runs first on the shared worker and places two more seeded talks on the
// grid, so the programme's size is not fixed. Session identity is asserted by
// title, and ordering by relative index.
// ---------------------------------------------------------------------------

/** Aisha Nwosu co-presents HOSPITAL and nothing else — a speaker name that
 * appears in no session title, so matching it can only come from the speaker
 * index. */
const AISHA_SURNAME = "Nwosu";

/** Picks an option in the native facet selects by their accessible name. */
async function chooseFacet(page: Page, label: string, option: string): Promise<void> {
  await page.getByLabel(label).selectOption({ label: option });
}

test("schedule search matches speaker names, not just session titles", async ({ page }) => {
  await page.goto(SCHEDULE);
  await expect(page.getByText(RETRIEVAL)).toBeVisible();

  await page.getByLabel("Search sessions by title or speaker").fill(AISHA_SURNAME);

  // One match, and it is the talk she co-presents — on day 2, so the day tabs
  // follow the search rather than stranding the attendee on an empty day 1.
  await expect(page.getByTestId("session-count")).toContainText("1 of");
  await expect(page.getByText(HOSPITAL)).toBeVisible();
  await expect(page.getByText(RETRIEVAL)).toHaveCount(0);
  await expect(page.getByText(INFERENCE)).toHaveCount(0);

  // A term that matches nothing at all says so rather than showing an empty
  // grid.
  await page.getByLabel("Search sessions by title or speaker").fill("zzzznotathing");
  await expect(page.getByTestId("session-count")).toContainText("0 of");
  await expect(page.getByText("No sessions match")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByText(RETRIEVAL)).toBeVisible();
  await expect(page.getByTestId("session-count")).toHaveText(/^\d+ sessions$/);
});

test("the track facet narrows the schedule to one track", async ({ page }) => {
  await page.goto(SCHEDULE);

  await chooseFacet(page, "Filter by track", "AI Engineering");

  // Both AI Engineering talks survive; the Agents & Tool Use one on day 2
  // leaves the programme entirely, as does anything another spec placed on
  // day 1 under a different track.
  await expect(page.getByText(RETRIEVAL)).toBeVisible();
  await expect(page.getByText(INFERENCE)).toBeVisible();
  await expect(page.getByText(HOSPITAL)).toHaveCount(0);
  await expect(page.getByText("Evals you'll actually keep running")).toHaveCount(0);
  await expect(page.getByTestId("session-count")).toContainText(" of ");

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByTestId("session-count")).toHaveText(/^\d+ sessions$/);
});

test("a schedule session opens a detail view and closes back to the schedule", async ({ page }) => {
  await page.goto(SCHEDULE);

  await page.getByRole("button", { name: RETRIEVAL, exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(RETRIEVAL);
  await expect(dialog).toContainText(PRIYA);
  // Full start–end time (in the event's own timezone), room, track, format.
  await expect(dialog).toContainText("10:00 AM");
  await expect(dialog).toContainText("10:45 AM");
  await expect(dialog).toContainText("Main Stage");
  await expect(dialog).toContainText("AI Engineering");
  await expect(dialog).toContainText("45-minute talk");
  // ...and the abstract itself.
  await expect(dialog).toContainText("Most RAG demos fall over");

  await dialog.getByRole("button", { name: "Back to schedule" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(RETRIEVAL)).toBeVisible();
  await expect(page.getByText(INFERENCE)).toBeVisible();
});

test("the speaker directory is ordered by surname and searchable by name", async ({ page }) => {
  await page.goto(SPEAKERS);

  const names = await page.getByRole("heading", { level: 3 }).allTextContents();
  const position = (name: string) => names.indexOf(name);
  expect(position(PRIYA)).toBeGreaterThan(-1);
  // Both pairs would come out the other way round under a first-name sort:
  // Beckett before Raman (Tom after Priya), Fernández before Kim (Luis after
  // Hannah).
  expect(position("Tom Beckett")).toBeLessThan(position(PRIYA));
  expect(position("Luis Fernández")).toBeLessThan(position("Hannah Kim"));

  await page.getByLabel("Search speakers by name").fill("Beckett");
  await expect(page.getByTestId("speaker-count")).toContainText("1 of");
  await expect(page.getByRole("heading", { name: "Tom Beckett" })).toBeVisible();
  await expect(page.getByRole("heading", { name: PRIYA })).toHaveCount(0);

  await page.getByLabel("Search speakers by name").fill("zzzznotathing");
  await expect(page.getByText("No speakers match")).toBeVisible();
});

test("a gallery card opens the speaker's profile and closes back to the grid", async ({ page }) => {
  await page.goto(SPEAKERS);

  // Tom, not Priya: portal.spec.ts runs first and rewrites Priya's title and
  // bio through the profile editor, so her seeded values are already gone by
  // the time this file runs. Tom's profile is mutated by no other spec.
  await page.getByRole("button", { name: "Tom Beckett", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Tom Beckett");
  await expect(dialog).toContainText("Principal Engineer");
  await expect(dialog).toContainText("Halyard");
  await expect(dialog).toContainText("batch inference cheap enough to be boring");
  // His session, with when and where.
  await expect(dialog).toContainText(INFERENCE);
  await expect(dialog).toContainText("11:00 AM");
  await expect(dialog).toContainText("Community Hall");

  await dialog.getByRole("button", { name: "Back to speakers" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: PRIYA })).toBeVisible();
  await expect(page.getByRole("heading", { name: DAMOLA })).toBeVisible();

  // A speaker seeded with no bio and no headshot still gets a complete
  // profile rather than a broken one.
  await page.getByRole("button", { name: "Luis Fernández", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No biography yet.");
  await page.getByRole("dialog").getByRole("button", { name: "Back to speakers" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("starring sessions builds a personal schedule that survives a reload", async ({ page }) => {
  await page.goto(SCHEDULE);

  await page.getByRole("button", { name: `Add to my schedule: ${RETRIEVAL}` }).click();
  await page.getByRole("button", { name: `Add to my schedule: ${INFERENCE}` }).click();

  const myScheduleTab = page.getByRole("tab", { name: /My schedule/ });
  await expect(myScheduleTab).toContainText("(2)");
  await myScheduleTab.click();

  const list = page.getByTestId("itinerary-list");
  await expect(page.getByTestId("itinerary-count")).toHaveText("2 starred sessions");
  await expect(list).toContainText(RETRIEVAL);
  await expect(list).toContainText(INFERENCE);
  await expect(list).not.toContainText(HOSPITAL);
  // Time order, not click order: the 10:00 talk sits above the 11:00 one.
  await expect(list.locator("li").first()).toContainText(RETRIEVAL);

  // localStorage, so it outlives a full reload with no account anywhere.
  await page.reload();
  await page.getByRole("tab", { name: /My schedule/ }).click();
  await expect(page.getByTestId("itinerary-count")).toHaveText("2 starred sessions");

  // Unstarring from the personal view updates it immediately.
  await page
    .getByTestId("itinerary-list")
    .getByRole("button", { name: `Remove from my schedule: ${INFERENCE}` })
    .click();
  await expect(page.getByTestId("itinerary-count")).toHaveText("1 starred session");
  await expect(page.getByTestId("itinerary-list")).toContainText(RETRIEVAL);
  await expect(page.getByTestId("itinerary-list")).not.toContainText(INFERENCE);
});

test("the personal schedule exports a calendar file of exactly the starred sessions", async ({
  page,
}) => {
  await page.goto(SCHEDULE);
  await page.getByRole("button", { name: `Add to my schedule: ${RETRIEVAL}` }).click();

  await page.getByRole("tab", { name: /My schedule/ }).click();
  const href = await page.getByRole("link", { name: /Add to calendar/ }).getAttribute("href");
  expect(href).toBeTruthy();

  // Fetched rather than downloaded: the file is written by a route handler
  // (src/app/p/[eventSlug]/itinerary.ics), so there is a real response to
  // assert on — headers included.
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  expect(response.headers()["content-disposition"]).toContain(".ics");

  const body = await response.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("BEGIN:VEVENT");
  expect(body).toContain(RETRIEVAL);
  expect(body).toContain("Main Stage");
  expect(body).toContain("END:VCALENDAR");
  // Only what was starred.
  expect(body).not.toContain(INFERENCE);
});

test("the embed schedule keeps search and filters but no personal itinerary", async ({ page }) => {
  await page.goto(EMBED_SCHEDULE);

  // A starred list belongs to the attendee's own visit, not to a third-party
  // page that iframes the programme.
  await expect(page.getByRole("tab", { name: /My schedule/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add to my schedule/ })).toHaveCount(0);

  await page.getByLabel("Search sessions by title or speaker").fill(AISHA_SURNAME);
  await expect(page.getByTestId("session-count")).toContainText("1 of");
  await expect(page.getByText(HOSPITAL)).toBeVisible();

  await page.goto(EMBED_SPEAKERS);
  await page.getByLabel("Search speakers by name").fill("Beckett");
  await expect(page.getByTestId("speaker-count")).toContainText("1 of");
});
