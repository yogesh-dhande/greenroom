import { addRoom, createDirectSession, expect, test, type IsolatedEvent } from "./fixtures";
import { signIn } from "./helpers";
import type { Locator, Page } from "@playwright/test";

function eventDayLabel(event: IsolatedEvent): string {
  return new Date(`${event.startDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function card(page: Page, title: string): Locator {
  return page.locator("[data-session-id]").filter({ hasText: title });
}

function trayCard(page: Page, title: string): Locator {
  return page.getByTestId("unscheduled-tray").locator("[data-session-id]").filter({ hasText: title });
}

async function choose(page: Page, trigger: string, option: string): Promise<void> {
  await page.locator(trigger).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function schedule(
  page: Page,
  title: string,
  values: { day?: string; room?: string; start?: string; duration?: string },
): Promise<void> {
  await card(page, title).first().click();
  if (values.day) await choose(page, "#session-day", values.day);
  if (values.room) await choose(page, "#session-room", values.room);
  if (values.start) await page.locator("#session-start").fill(values.start);
  if (values.duration) await choose(page, "#session-duration", values.duration);
  await page.getByRole("dialog").getByRole("button", { name: "Save time" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("an isolated agenda places, moves, conflicts, resolves, unschedules, and drags sessions", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  await page.setViewportSize({ width: 1600, height: 1500 });
  const firstRoom = `Alpha ${fixtureId}`;
  const secondRoom = `Beta ${fixtureId}`;
  await addRoom(page, isolatedEvent.slug, firstRoom);
  await addRoom(page, isolatedEvent.slug, secondRoom);
  const anchor = await createDirectSession(page, isolatedEvent.slug, `${fixtureId}-anchor`, {
    title: `Anchor ${fixtureId}`,
  });
  const moving = await createDirectSession(page, isolatedEvent.slug, `${fixtureId}-moving`, {
    title: `Moving ${fixtureId}`,
  });
  const day = eventDayLabel(isolatedEvent);

  await schedule(page, anchor.title, { day, room: firstRoom, start: "10:00", duration: "45 minutes" });
  await page.reload();
  await expect(card(page, anchor.title)).toContainText("10:00 AM");

  await schedule(page, moving.title, { day, room: firstRoom, start: "10:00" });
  await expect(card(page, anchor.title)).toHaveAttribute("data-conflict", "blocking");
  await expect(card(page, moving.title)).toContainText("Room double-booked");
  await expect(page.getByTestId("conflict-summary")).toContainText("1 conflict");

  await schedule(page, moving.title, { room: secondRoom });
  await expect(page.getByText("No scheduling conflicts")).toBeVisible();
  await card(page, moving.title).first().click();
  await expect(page.locator("#session-room")).toContainText(secondRoom);
  await choose(page, "#session-duration", "Custom...");
  await page.locator("#session-duration-custom").fill("25");
  await page.getByRole("dialog").getByRole("button", { name: "Save time" }).click();

  await card(page, moving.title).first().click();
  await expect(page.locator("#session-duration-custom")).toHaveValue("25");
  await page.keyboard.press("Escape");

  await card(page, moving.title).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Unschedule" }).click();
  await expect(trayCard(page, moving.title)).toBeVisible();
  // Wait for the server action/revalidation behind the optimistic tray move so
  // the newly mounted card has an active dnd-kit listener before dragging it.
  await page.reload();
  await expect(trayCard(page, moving.title)).toBeVisible();

  const columns = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll<HTMLElement>("[data-slot-id]")].map(
        (element) => element.dataset.slotId!.split("|")[1],
      ),
    ),
  ]);
  const target = page.locator(`[data-slot-id="slot|${columns[1]}|780"]`);
  const source = await trayCard(page, moving.title).boundingBox();
  const drop = await target.boundingBox();
  if (!source || !drop) throw new Error("Agenda drag endpoints are not visible");
  await page.mouse.move(source.x + 20, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(source.x + 32, source.y + 22, { steps: 6 });
  await expect(trayCard(page, moving.title)).toHaveClass(/opacity-40/);
  await page.mouse.move(drop.x + 20, drop.y + drop.height / 2, { steps: 20 });
  await expect(target).toHaveClass(/bg-accent/);
  await page.mouse.up();
  await expect(trayCard(page, moving.title)).toHaveCount(0);
  await expect(card(page, moving.title)).toContainText("1:00 PM");
  await page.reload();
  await expect(card(page, moving.title)).toContainText("1:00 PM");
});

test("an isolated agenda detects and clears a speaker double-booking", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const firstRoom = `Alpha ${fixtureId}`;
  const secondRoom = `Beta ${fixtureId}`;
  await addRoom(page, isolatedEvent.slug, firstRoom);
  await addRoom(page, isolatedEvent.slug, secondRoom);
  const first = await createDirectSession(page, isolatedEvent.slug, `${fixtureId}-first`, {
    title: `First ${fixtureId}`,
  });

  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog", { name: "New session" });
  const secondTitle = `Second ${fixtureId}`;
  await dialog.locator("#new-session-title").fill(secondTitle);
  await dialog.getByLabel("Add an existing speaker").click();
  await page.getByRole("option", { name: new RegExp(first.speakerName) }).click();
  await dialog.getByRole("button", { name: "Create session" }).click();
  await expect(trayCard(page, secondTitle)).toContainText(first.speakerName);

  const day = eventDayLabel(isolatedEvent);
  await schedule(page, first.title, { day, room: firstRoom, start: "10:00" });
  await schedule(page, secondTitle, { day, room: secondRoom, start: "10:15" });
  await expect(card(page, first.title)).toHaveAttribute("data-conflict", "blocking");
  await page.getByTestId("conflict-summary").click();
  await expect(page.locator('[data-slot="popover-content"]')).toContainText("Speaker double-booked");
  await page.keyboard.press("Escape");

  await schedule(page, secondTitle, { start: "12:00" });
  await expect(page.getByText("No scheduling conflicts")).toBeVisible();
});

test("reviewers are bounced from the agenda entirely", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");
  await page.goto("/admin/ai-engineer-summit-2026/agenda");
  await expect(page).not.toHaveURL(/\/agenda/);
  await expect(page.getByTestId("unscheduled-tray")).toHaveCount(0);
});
