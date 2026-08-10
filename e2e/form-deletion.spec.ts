import { createIsolatedForm, expect, publishForm, test } from "./fixtures";
import { signIn } from "./helpers";

test("an unused form can be deleted from its builder", async ({ page, fixtureId, isolatedEvent }) => {
  const form = await createIsolatedForm(page, isolatedEvent.slug, fixtureId);

  await page.getByRole("button", { name: "Delete form" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`Delete “${form.name}”?`);
  await confirm.getByRole("button", { name: "Delete form" }).click();

  await expect(page).toHaveURL(`/admin/${isolatedEvent.slug}/forms`);
  await expect(page.getByRole("link", { name: form.name })).toHaveCount(0);
  const publicResponse = await page.request.get(form.publicPath);
  expect(publicResponse.status()).toBe(404);
});

test("a form linked from onboarding names the blocking task instead of deleting", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const form = await createIsolatedForm(page, isolatedEvent.slug, fixtureId);
  const taskName = `Task ${fixtureId}`;

  await page.goto(`/admin/${isolatedEvent.slug}/tasks`);
  await page.getByRole("button", { name: "New task" }).click();
  const taskDialog = page.getByRole("dialog", { name: "New task" });
  await taskDialog.getByLabel("Title", { exact: true }).fill(taskName);
  await taskDialog.getByLabel("Type", { exact: true }).click();
  await page.getByRole("option", { name: "Fill out a form" }).click();
  await taskDialog.getByLabel("Form", { exact: true }).click();
  await page.getByRole("option", { name: form.name }).click();
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();

  await page.goto(form.builderPath);
  await page.getByRole("button", { name: "Delete form" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Delete form" }).click();

  await expect(confirm.getByRole("alert")).toContainText(
    `The onboarding task "${taskName}" asks speakers to fill this form in`,
  );
  await expect(page).toHaveURL(form.builderPath);
});

test("a form with a response refuses deletion and remains available", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const form = await createIsolatedForm(page, isolatedEvent.slug, fixtureId);
  await publishForm(page, form);
  await page.context().clearCookies();
  await page.goto(form.publicPath);
  await page.getByLabel("Talk title").fill(`Draft ${fixtureId}`);
  await page.getByLabel("Your email").fill(`${fixtureId}@example.com`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Picking up where you left off")).toBeVisible();

  await signIn(page, "admin@greenroom.dev");
  await page.goto(form.builderPath);
  await page.getByRole("button", { name: "Delete form" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Delete form" }).click();
  await expect(confirm.getByRole("alert")).toContainText(
    "This form has submissions — unpublish it instead of deleting it",
  );
  expect((await page.request.get(form.publicPath)).status()).toBe(200);
});
