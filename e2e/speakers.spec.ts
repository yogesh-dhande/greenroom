import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: speaker roster filters (spec.md §5, decisions.md D-051/D-068) —
 * search, task-completion, and their composition. Eval run 4 (CRM-02) reported
 * search not composing with an active status filter on the deployed site; this
 * pins the composed behavior in a healthy environment so a recurrence is
 * attributable to infra, not the filter logic.
 *
 * Read-only: no mutations, safe wherever it lands in the file order.
 */

const SPEAKERS = "/admin/ai-engineer-summit-2026/speakers";

test("search narrows the roster and lands in the URL", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS);

  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toBeVisible();

  await page.getByLabel("Search speakers").fill("Raman");

  // The box debounces 250ms before pushing to the URL; the server filters.
  await expect(page).toHaveURL(/q=Raman/);
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toHaveCount(0);
});

test("search composes with an active task-completion filter", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS);

  // Same order as the eval repro: filter first, then type.
  await page.getByLabel("Filter by task completion").click();
  await page.getByRole("option", { name: "Tasks outstanding" }).click();
  await expect(page).toHaveURL(/status=incomplete/);

  // Hannah Kim keeps outstanding tasks through the whole suite (the portal
  // spec completes Priya's), so she matches both criteria.
  await page.getByLabel("Search speakers").fill("Kim");

  // Both criteria must survive into the URL and AND together in the rows.
  await expect(page).toHaveURL(/status=incomplete/);
  await expect(page).toHaveURL(/q=Kim/);
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Priya Raman" })).toHaveCount(0);

  // Clear filters resets both criteria at once.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/status=|q=/);
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toBeVisible();
});
