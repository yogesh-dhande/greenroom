import { expect, test, type Page } from "@playwright/test";
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
const IMPORT_EXISTING = "Mara Velasquez";
const IMPORT_EXISTING_EMAIL = "mara.velasquez@example.com";
const IMPORT_NEW = "Tobias Mercer";
const IMPORT_NEW_EMAIL = "tobias.mercer@example.com";
const FILTER_UNCONFIRMED = "Noor Iqbal";
const FILTER_UNCONFIRMED_EMAIL = "noor.iqbal@example.com";

async function addSpeaker(page: Page, name: string, email: string) {
  await page.getByRole("button", { name: "Add speaker" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByRole("button", { name: "Add speaker" }).click();
  await expect(page.getByText(`${name} was added to the roster`)).toBeVisible();
}

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

test("CSV import creates new speakers and merges an existing email without duplicating it", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS);
  await addSpeaker(page, IMPORT_EXISTING, IMPORT_EXISTING_EMAIL);

  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Import speakers" });
  await dialog.getByLabel("Paste CSV").fill(
    [
      "name,email,title,company,bio",
      `${IMPORT_EXISTING},${IMPORT_EXISTING_EMAIL},Principal Engineer,Northstar Labs,`,
      `${IMPORT_NEW},${IMPORT_NEW_EMAIL},Developer Advocate,Field Notes,Imported through CSV`,
    ].join("\n"),
  );
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  await expect(dialog.getByText("1 created · 1 merged · 0 skipped")).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: IMPORT_EXISTING_EMAIL })).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: IMPORT_NEW_EMAIL })).toBeVisible();
  await expect(dialog.getByText("Merged", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Created", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Search speakers").fill(IMPORT_EXISTING_EMAIL);
  await expect(page).toHaveURL(/q=mara\.velasquez/);
  await expect(page.getByRole("link", { name: IMPORT_EXISTING })).toHaveCount(1);

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search speakers").fill(IMPORT_NEW_EMAIL);
  await expect(page).toHaveURL(/q=tobias\.mercer/);
  await expect(page.getByRole("link", { name: IMPORT_NEW })).toHaveCount(1);
});

test("confirmation filter separates confirmed speakers from speakers still awaiting confirmation", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS);
  await addSpeaker(page, FILTER_UNCONFIRMED, FILTER_UNCONFIRMED_EMAIL);

  await page.getByLabel("Filter by confirmation").click();
  await page.getByRole("option", { name: "Not yet confirmed" }).click();
  await expect(page).toHaveURL(/confirmation=unconfirmed/);
  await expect(page.getByRole("link", { name: FILTER_UNCONFIRMED })).toBeVisible();
  await expect(page.getByRole("link", { name: "Priya Raman" })).toHaveCount(0);

  await page.getByLabel("Filter by confirmation").click();
  await page.getByRole("option", { name: "Confirmed", exact: true }).click();
  await expect(page).toHaveURL(/confirmation=confirmed/);
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
  await expect(page.getByRole("link", { name: FILTER_UNCONFIRMED })).toHaveCount(0);
});
