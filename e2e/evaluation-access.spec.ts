import { expect, test } from "@playwright/test";

const ACCESS_TOKEN = "e2e-evaluation-access-token-32-bytes-minimum";

async function openAccess(page: import("@playwright/test").Page) {
  await page.goto(`/demo#token=${ACCESS_TOKEN}`);
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "Demo access" })).toBeVisible();
}

test("the private evaluation entrance signs in each fixed persona without granting roles", async ({
  browser,
}) => {
  const organizer = await browser.newContext();
  const organizerPage = await organizer.newPage();
  await openAccess(organizerPage);
  await organizerPage.getByRole("button", { name: /Sign in as Organizer/ }).click();
  await expect(organizerPage).toHaveURL(/\/admin$/);
  await expect(organizerPage.getByRole("heading", { name: "Your events" })).toBeVisible();
  await expect(organizerPage.getByRole("link", { name: "New event" })).toBeVisible();

  const reviewer = await browser.newContext();
  const reviewerPage = await reviewer.newPage();
  await openAccess(reviewerPage);
  await reviewerPage.getByRole("button", { name: /Sign in as Reviewer/ }).click();
  await expect(reviewerPage).toHaveURL(/\/admin$/);
  await expect(reviewerPage.getByText("AI Engineer Summit 2026", { exact: true })).toBeVisible();
  await expect(reviewerPage.getByRole("link", { name: "New event" })).toHaveCount(0);
  await reviewerPage.goto("/admin/ai-engineer-summit-2026/team");
  await expect(reviewerPage).toHaveURL(/\/admin$/);

  const speaker = await browser.newContext();
  const speakerPage = await speaker.newPage();
  await openAccess(speakerPage);
  await speakerPage.getByRole("button", { name: /Sign in as Speaker/ }).click();
  await expect(speakerPage).toHaveURL(/\/portal$/);
  await speakerPage.goto("/admin");
  await expect(speakerPage).toHaveURL(/\/portal$/);

  await Promise.all([organizer.close(), reviewer.close(), speaker.close()]);
});

test("the evaluation entrance rejects a wrong capability without a session", async ({ page }) => {
  const crossOrigin = await page.request.post("/api/auth/evaluation-login", {
    headers: { origin: "https://attacker.example" },
    data: { persona: "organizer", token: ACCESS_TOKEN },
  });
  expect(crossOrigin.status()).toBe(403);

  const getAttempt = await page.request.get("/api/auth/evaluation-login");
  expect(getAttempt.ok()).toBe(false);

  await page.goto("/demo#token=wrong-token");
  await page.getByRole("button", { name: /Sign in as Organizer/ }).click();
  await expect(page.getByText("This demo link is invalid", { exact: false })).toContainText(
    "invalid, expired, or no longer enabled",
  );
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
