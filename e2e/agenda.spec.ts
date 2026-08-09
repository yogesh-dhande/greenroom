import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: the agenda builder (spec.md §9) — placing sessions on a day/room
 * grid, moving them, live conflict detection that warns without blocking, and
 * direct session entry for speakers who never went through the CFP
 * (spec.md §5). Runs against the seeded demo event, whose agenda starts with
 * three scheduled and three unscheduled sessions.
 *
 * Tests run in file order on one worker and build on each other's state.
 */

const AGENDA = "/admin/ai-engineer-summit-2026/agenda";

/** Day labels as the day selector renders them ("Jun 16, 2026"): the seed
 * places the event 45 days out (scripts/seed.ts EVENT_DAY_1, UTC-derived),
 * and formatDay renders "YYYY-MM-DD" strings in UTC. */
function eventDayLabel(dayIndex = 0): string {
  return new Date(Date.now() + (45 + dayIndex) * 24 * 60 * 60 * 1000).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The seeded 45-minute talk on Main Stage at 10:00 on event day 1, with
 * Priya Raman speaking — the fixture every conflict here is built against. */
const RETRIEVAL = "Retrieval that survives production traffic";
const EVALS = "Evals you'll actually keep running";
const TOOL_SCHEMAS = "Tool schemas are your real prompt";

function card(page: Page, title: string): Locator {
  return page.locator("[data-session-id]").filter({ hasText: title });
}

function trayCard(page: Page, title: string): Locator {
  return page.getByTestId("unscheduled-tray").locator("[data-session-id]").filter({
    hasText: title,
  });
}

/** Picks an option in a shadcn/Radix select by its visible label. */
async function choose(page: Page, trigger: string, option: string): Promise<void> {
  await page.locator(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

/** Opens a session's time dialog and sets day/room/start/duration. */
async function schedule(
  page: Page,
  title: string,
  { day, room, start, duration }: { day?: string; room?: string; start?: string; duration?: string },
): Promise<void> {
  await card(page, title).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (day) await choose(page, "#session-day", day);
  if (room) await choose(page, "#session-room", room);
  if (start) await page.locator("#session-start").fill(start);
  if (duration) await choose(page, "#session-duration", duration);
  await dialog.getByRole("button", { name: "Save time" }).click();
  await expect(dialog).toHaveCount(0);
}

test("admin places an unscheduled session with the time dialog", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  const tray = page.getByTestId("unscheduled-tray");
  await expect(tray.getByText(EVALS)).toBeVisible();
  await expect(page.getByText("No scheduling conflicts")).toBeVisible();

  await schedule(page, EVALS, {
    day: eventDayLabel(),
    room: "Workshop A",
    start: "09:00",
    duration: "45 minutes",
  });

  // It leaves the tray for the grid, showing the exact time it was given.
  await expect(trayCard(page, EVALS)).toHaveCount(0);
  await expect(card(page, EVALS)).toContainText("9:00 AM");
  await expect(card(page, EVALS)).toContainText("9:45 AM");

  // Written through immediately — no save button, so a reload proves it.
  await page.reload();
  await expect(card(page, EVALS)).toContainText("9:00 AM");
});

test("admin moves a placed session to another room", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  await schedule(page, EVALS, { room: "Workshop B" });

  await page.reload();
  await card(page, EVALS).first().click();
  await expect(page.locator("#session-room")).toHaveText("Workshop B");
  await page.keyboard.press("Escape");
});

test("a room double-booking is flagged loudly but still allowed", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  // Straight on top of the seeded 10:00 Main Stage talk.
  await schedule(page, EVALS, { room: "Main Stage", start: "10:00" });

  // The placement is honoured — both cards are on the board, both marked.
  await expect(card(page, EVALS)).toHaveAttribute("data-conflict", "blocking");
  await expect(card(page, RETRIEVAL)).toHaveAttribute("data-conflict", "blocking");
  await expect(card(page, EVALS)).toContainText("Room double-booked");

  const summary = page.getByTestId("conflict-summary");
  await expect(summary).toContainText("1 conflict");
  await summary.click();
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover).toContainText("Room double-booked");
  await expect(popover).toContainText(RETRIEVAL);
  await page.keyboard.press("Escape");

  // And it survives a reload — a conflict is never a reason to drop the write.
  await page.reload();
  await expect(card(page, EVALS)).toHaveAttribute("data-conflict", "blocking");
});

test("moving the session off the clash clears the conflict", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  await schedule(page, EVALS, { room: "Workshop A", start: "13:00" });

  await expect(page.getByText("No scheduling conflicts")).toBeVisible();
  await expect(page.locator('[data-conflict="blocking"]')).toHaveCount(0);
  await expect(page.getByTestId("conflict-summary")).toHaveCount(0);
});

test("admin drags a session from the tray onto the grid", async ({ page }) => {
  // A viewport tall enough for the whole grid: dnd-kit auto-scrolls while
  // dragging near a scroll container's edge, which would move the drop target
  // out from under the pointer mid-drag.
  await page.setViewportSize({ width: 1600, height: 1500 });
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  await expect(trayCard(page, TOOL_SCHEMAS)).toBeVisible();

  // Column ids come from the rendered slots, in room order.
  const columns = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll<HTMLElement>("[data-slot-id]")].map(
        (el) => el.dataset.slotId!.split("|")[1],
      ),
    ),
  ]);
  // 9:30 in Workshop A (rooms are listed alphabetically, so columns[2] is
  // Workshop A: Community Hall, Main Stage, Workshop A, Workshop B).
  const target = page.locator(`[data-slot-id="slot|${columns[2]}|570"]`);

  const source = await trayCard(page, TOOL_SCHEMAS).boundingBox();
  const drop = await target.boundingBox();
  expect(source && drop).toBeTruthy();

  await page.mouse.move(source!.x + source!.width / 2, source!.y + 8);
  await page.mouse.down();
  // Past the 5px activation threshold first, then across in small steps so
  // dnd-kit sees a real pointer path.
  await page.mouse.move(source!.x + source!.width / 2 + 20, source!.y + 24, { steps: 5 });
  await page.mouse.move(drop!.x + drop!.width / 2, drop!.y + drop!.height / 2, { steps: 20 });
  await expect(target).toHaveClass(/bg-accent/);
  await page.mouse.up();

  await expect(trayCard(page, TOOL_SCHEMAS)).toHaveCount(0);
  await expect(card(page, TOOL_SCHEMAS)).toContainText("9:30 AM");

  await page.reload();
  await expect(card(page, TOOL_SCHEMAS)).toContainText("9:30 AM");
});

test("admin creates a session directly, with a speaker who is new to Greenroom", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#new-session-title").fill("Sponsor keynote: shipping with Northwind");
  await dialog
    .locator("#new-session-description")
    .fill("How Northwind ships agents in regulated environments.");
  await choose(page, "#new-session-track", "AI Engineering");
  await dialog.locator("#new-speaker-name").fill("Jordan Reyes");
  await dialog.locator("#new-speaker-email").fill("jordan.reyes@sponsor.example");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText("Jordan Reyes")).toBeVisible();
  await dialog.getByRole("button", { name: "Create session" }).click();

  await expect(page.getByText("Session added to the unscheduled tray")).toBeVisible();
  const created = trayCard(page, "Sponsor keynote");
  await expect(created).toBeVisible();
  // The new person was created and linked, not just remembered in the form.
  await expect(created).toContainText("Jordan Reyes");

  await page.reload();
  await expect(trayCard(page, "Sponsor keynote")).toContainText("Jordan Reyes");
});

test("a speaker booked in two places at once is flagged", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  // Priya Raman already speaks at 10:00 on event day 1 (Main Stage).
  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#new-session-title").fill("Fireside chat with Priya");
  await page.getByLabel("Add an existing speaker").click();
  await page.getByRole("option", { name: /Priya Raman/ }).click();
  await dialog.getByRole("button", { name: "Create session" }).click();
  await expect(trayCard(page, "Fireside chat")).toBeVisible();

  await schedule(page, "Fireside chat", {
    day: eventDayLabel(),
    room: "Community Hall",
    start: "10:15",
    duration: "30 minutes",
  });

  await expect(card(page, "Fireside chat")).toHaveAttribute("data-conflict", "blocking");
  await expect(card(page, RETRIEVAL)).toHaveAttribute("data-conflict", "blocking");
  const summary = page.getByTestId("conflict-summary");
  await summary.click();
  await expect(page.locator('[data-slot="popover-content"]')).toContainText(
    "Speaker double-booked",
  );
  await page.keyboard.press("Escape");

  // Moving it later frees Priya up.
  await schedule(page, "Fireside chat", { start: "13:00" });
  await expect(page.getByText("No scheduling conflicts")).toBeVisible();
});

test("admin sends a session back to the unscheduled tray", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(AGENDA);

  await card(page, "Fireside chat").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Unschedule" }).click();

  await expect(trayCard(page, "Fireside chat")).toBeVisible();
  await page.reload();
  await expect(trayCard(page, "Fireside chat")).toBeVisible();
});

test("reviewers can read the agenda but not rearrange it", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await page.goto(AGENDA);

  await expect(page.getByTestId("unscheduled-tray")).toBeVisible();
  await expect(page.getByRole("button", { name: "New session" })).toHaveCount(0);

  // The time dialog opens read-only.
  await card(page, RETRIEVAL).first().click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save time" })).toBeDisabled();
});
