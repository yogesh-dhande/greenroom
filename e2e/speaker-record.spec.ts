import { addSpeaker, createTask, expect, test } from "./fixtures";
import { devEmailsSince, signIn } from "./helpers";

const HEADSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a first-class speaker record owns profile, notes, tasks, files, invite, and portal entry", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const name = `Speaker ${fixtureId}`;
  const editedName = `Edited ${name}`;
  const email = `${fixtureId}@example.com`;
  const task = `Confirm ${fixtureId}`;
  const note = `Window seat and vegetarian meal — ${fixtureId}`;

  await addSpeaker(page, isolatedEvent.slug, { name, email });
  await createTask(page, isolatedEvent.slug, task);
  await page.goto(`/admin/${isolatedEvent.slug}/speakers`);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(editedName);
  await page.getByLabel("Title", { exact: true }).fill("Principal Engineer");
  await page.getByLabel("Company", { exact: true }).fill("Fixture Labs");
  await page.getByLabel("Bio", { exact: true }).fill("Builds isolated test systems.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();

  await page.getByLabel("Internal notes").fill(note);
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved")).toBeVisible();

  await page.getByLabel("Upload headshot").setInputFiles({
    name: `${fixtureId}.png`,
    mimeType: "image/png",
    buffer: HEADSHOT,
  });
  await expect(page.getByText("Headshot updated")).toBeVisible();
  await expect(page.getByRole("img", { name: `${editedName}'s headshot` })).toBeVisible();

  await page.getByLabel("Task", { exact: true }).click();
  await page.getByRole("option", { name: task, exact: true }).click();
  await page.getByRole("button", { name: "Assign task" }).click();
  await expect(page.getByText(`"${task}" assigned to ${editedName}`)).toBeVisible();
  await expect(page.getByText(task)).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();

  const inviteAt = Date.now();
  await page.getByRole("button", { name: "Send portal invite" }).click();
  await expect(page.getByText(`Portal invitation sent to ${email}`)).toBeVisible();
  await expect(async () => {
    const invitation = (await devEmailsSince(inviteAt)).find(
      (body) => body.includes(email) && body.includes("X-Greenroom-Log: portal_invite"),
    );
    expect(invitation).toBeTruthy();
    expect(invitation).toContain(isolatedEvent.name);
    expect(invitation).toContain("/portal");
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("Portal invite")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: editedName })).toBeVisible();
  await expect(page.getByLabel("Internal notes")).toHaveValue(note);
  await expect(page.getByText(task)).toBeVisible();

  await signIn(page, email);
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Your speaker home" })).toBeVisible();
  await expect(page.getByText(isolatedEvent.name)).toBeVisible();
  await expect(page.getByText(task)).toBeVisible();
  const profileLink = page.getByRole("link", { name: "Your profile", exact: true });
  await expect(profileLink).toBeVisible();
  await profileLink.click();
  await expect(page).toHaveURL(/\/portal\/profile$/);
  await expect(page.getByLabel("Your name")).toHaveValue(editedName);
});
