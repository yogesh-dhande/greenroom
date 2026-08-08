import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: admin signs in with a magic link, creates an event, and manages
 * tracks/rooms — including the guard that a referenced track can't be
 * deleted (spec.md §1). Runs against the seeded demo database.
 */

test("unauthenticated visitors are redirected to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("admin creates an event with an auto-derived slug", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");

  await page.goto("/admin/new");
  await page.getByLabel("Event name").fill("Playwright Test Summit");
  await expect(page.getByLabel("URL slug")).toHaveValue("playwright-test-summit");
  await page.getByLabel("Start date").fill("2026-09-01");
  await page.getByLabel("End date").fill("2026-09-02");
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(/\/admin\/playwright-test-summit$/);
});

test("admin manages tracks in event settings", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");

  // The event created in the previous test (tests run in order, one worker).
  await page.goto("/admin/playwright-test-summit/settings");

  await page.getByRole("button", { name: "Add track" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("E2E Track");
  await page.getByRole("dialog").getByRole("button", { name: "Add track" }).click();
  await expect(page.getByText("Track added")).toBeVisible();
  await expect(page.getByRole("cell", { name: "E2E Track", exact: true })).toBeVisible();

  // An unreferenced track deletes cleanly after confirmation.
  await page.getByRole("button", { name: "Delete E2E Track" }).click();
  await page.getByRole("button", { name: "Delete track" }).click();
  await expect(page.getByText("Track deleted")).toBeVisible();
  await expect(page.getByRole("cell", { name: "E2E Track", exact: true })).toHaveCount(0);
});

test("deleting a referenced track is blocked with an explanation", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");

  // The seeded event has submissions/sessions attached to its tracks.
  await page.goto("/admin");
  await page.getByRole("link", { name: /AI Engineer Summit/ }).first().click();
  await page.getByRole("link", { name: "Settings" }).click();

  await page.getByRole("button", { name: "Delete AI Engineering" }).click();
  await page.getByRole("button", { name: "Delete track" }).click();
  await expect(page.getByText(/still used by/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "AI Engineering", exact: true })).toBeVisible();
});

test("reviewers see events but no admin-only affordances", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");

  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /AI Engineer Summit/ }).first()).toBeVisible();
  await expect(page.getByText("New event")).toHaveCount(0);
});
