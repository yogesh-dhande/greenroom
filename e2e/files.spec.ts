import { createDirectSession, createTask, expect, test } from "./fixtures";
import { signIn } from "./helpers";

const FIRST_FILE = Buffer.from("first version of the deck");
const SECOND_FILE = Buffer.from("second version of the deck");
const HEADSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function openTask(page: import("@playwright/test").Page, title: string) {
  const task = page.getByRole("group", { name: title });
  const trigger = task.locator("button[aria-expanded]").first();
  if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
  return task;
}

test("file replacements, cross-role comments, and the ZIP library share one isolated deliverable", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const speakerName = `Speaker ${fixtureId}`;
  const speakerEmail = `${fixtureId}@example.com`;
  const taskTitle = `Slides ${fixtureId}`;
  const firstName = `first-${fixtureId}.pdf`;
  const secondName = `current-${fixtureId}.pdf`;
  const headshotName = `headshot-${fixtureId}.png`;
  const speakerComment = `Please review slide 12 — ${fixtureId}`;
  const adminComment = `Slide 12 looks good — ${fixtureId}`;

  const session = await createDirectSession(page, isolatedEvent.slug, fixtureId, {
    title: `Session ${fixtureId}`,
  });
  await createTask(page, isolatedEvent.slug, taskTitle, "file");
  await page.goto(`/admin/${isolatedEvent.slug}/speakers`);
  await page.getByRole("link", { name: speakerName }).click();
  await page.getByLabel("Task", { exact: true }).click();
  await page.getByRole("option", { name: taskTitle, exact: true }).click();
  await page.getByRole("button", { name: "Assign task" }).click();
  await expect(page.getByText(`"${taskTitle}" assigned to ${speakerName}`)).toBeVisible();

  await signIn(page, speakerEmail);
  await page.goto("/portal");
  let task = await openTask(page, taskTitle);
  await task.getByLabel("Upload a file").setInputFiles({
    name: firstName,
    mimeType: "application/pdf",
    buffer: FIRST_FILE,
  });
  await task.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Uploaded — thanks!")).toBeVisible();

  task = await openTask(page, taskTitle);
  await task.getByRole("button", { name: "Replace file" }).click();
  await task.getByLabel("Upload a file").setInputFiles({
    name: secondName,
    mimeType: "application/pdf",
    buffer: SECOND_FILE,
  });
  await task.getByRole("button", { name: "Upload new version" }).click();
  await expect(page.getByText("New version uploaded.")).toBeVisible();
  await expect(task).toContainText("Version 2");
  await expect(task.getByText(firstName)).toBeVisible();
  await task.getByPlaceholder("Ask a question or leave a note for the organizers…").fill(speakerComment);
  await task.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible();

  await page.goto("/portal/profile");
  await page.getByLabel("Headshot").setInputFiles({
    name: headshotName,
    mimeType: "image/png",
    buffer: HEADSHOT,
  });
  await expect(page.getByRole("link", { name: headshotName })).toBeVisible();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();

  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${isolatedEvent.slug}/files`);
  const row = page.getByRole("row").filter({ hasText: secondName }).first();
  await expect(row).toContainText(speakerName);
  await expect(row).toContainText(taskTitle);
  await expect(row.getByText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)).toBeVisible();
  await expect(row).toContainText("2");
  const downloadHref = await row.getByRole("link", { name: "Download" }).getAttribute("href");
  const currentFile = await page.request.get(downloadHref!);
  expect(currentFile.status()).toBe(200);
  expect(await currentFile.body()).toEqual(SECOND_FILE);
  await page.getByRole("button", { name: "Versions and comments (1)" }).click();
  await expect(page.getByText(firstName)).toBeVisible();
  await expect(page.getByText(speakerComment)).toBeVisible();
  await page
    .getByPlaceholder("Ask for a change, or note what you did with this file…")
    .fill(adminComment);
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible();

  await expect(page.getByText("2 of 2 selected")).toBeVisible();
  await page.getByLabel(`Select ${headshotName}`).uncheck();
  await expect(page.getByText("1 of 2 selected")).toBeVisible();
  await page.getByLabel("Group folders by").selectOption("session");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download selected" }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const archiveBody = Buffer.concat(chunks);
  expect(archiveBody.subarray(0, 2).toString()).toBe("PK");
  expect(archiveBody.toString("latin1")).toContain(session.title);
  expect(archiveBody.toString("latin1")).toContain(secondName);
  expect(archiveBody.toString("latin1")).not.toContain(firstName);
  expect(archiveBody.toString("latin1")).not.toContain(headshotName);

  await signIn(page, speakerEmail);
  await page.goto("/portal");
  task = await openTask(page, taskTitle);
  await expect(task.getByText(adminComment)).toBeVisible();
  await expect(task.getByText("Avery Chen")).toBeVisible();
});
