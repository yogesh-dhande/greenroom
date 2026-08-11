import { expect, test } from "./fixtures";
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

test("admin creates an event with an auto-derived isolated slug", async ({ page, fixtureId }) => {
  const name = `Summit ${fixtureId}`;
  const expectedSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const day = (offset: number) =>
    new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await signIn(page, "admin@greenroom.dev");
  await page.goto("/admin/new");
  await page.getByLabel("Event name").fill(name);
  await expect(page.getByLabel("URL slug")).toHaveValue(expectedSlug);
  await page.getByLabel("Start date").fill(day(90));
  await page.getByLabel("End date").fill(day(91));
  await page.getByRole("button", { name: "Create event" }).click();

  await expect(page).toHaveURL(`/admin/${expectedSlug}`);
  await expect(page.getByRole("combobox", { name: "Switch event" })).toContainText(name);
});

test("admin manages tracks and rooms in an isolated event", async ({ page, isolatedEvent }) => {
  await page.goto(`/admin/${isolatedEvent.slug}/settings`);

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

  await page.getByRole("button", { name: "Add room" }).click();
  const addRoom = page.getByRole("dialog", { name: "Add room" });
  await addRoom.getByLabel("Name").fill("E2E Room");
  await addRoom.getByLabel("Capacity").fill("240");
  await addRoom.getByRole("button", { name: "Add room" }).click();
  await expect(page.getByText("Room added")).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E Room/ })).toContainText("240");

  await page.getByRole("button", { name: "Edit E2E Room" }).click();
  const editRoom = page.getByRole("dialog", { name: "Edit room" });
  await editRoom.getByLabel("Name").fill("E2E Room Updated");
  await editRoom.getByLabel("Capacity").fill("300");
  await editRoom.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Room updated")).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E Room Updated/ })).toContainText("300");

  await page.getByRole("button", { name: "Delete E2E Room Updated" }).click();
  const deleteDialog = page.getByRole("alertdialog");
  await expect(
    deleteDialog.getByRole("heading", { name: 'Delete "E2E Room Updated"?' }),
  ).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete room" }).click();
  await expect(page.getByRole("heading", { name: 'Delete ""?' })).toHaveCount(0);
  await expect(page.getByText("Room deleted")).toBeVisible();
  await expect(page.getByRole("cell", { name: "E2E Room Updated", exact: true })).toHaveCount(0);
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
