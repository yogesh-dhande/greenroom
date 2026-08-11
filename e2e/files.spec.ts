import { createDirectSession, createTask, expect, test } from "./fixtures";
import { signIn } from "./helpers";
import { unzipSync } from "fflate";

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

async function createSessionForExistingSpeaker(
  page: import("@playwright/test").Page,
  title: string,
  speakerName: string,
) {
  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog", { name: "New session" });
  await dialog.locator("#new-session-title").fill(title);
  await dialog.getByLabel("Add an existing speaker").click();
  await page.getByRole("option", { name: new RegExp(`^${speakerName}`) }).click();
  await dialog.getByRole("button", { name: "Create session" }).click();
  await expect(page.getByTestId("unscheduled-tray").getByText(title)).toBeVisible({
    timeout: 15_000,
  });
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
  const sessionTitles = [session.title];
  for (let index = 1; index <= 5; index += 1) {
    const title = `Associated session ${index} ${fixtureId}`;
    await createSessionForExistingSpeaker(page, title, speakerName);
    sessionTitles.push(title);
  }
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
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/admin/${isolatedEvent.slug}/files`);
  const row = page.getByRole("row").filter({ hasText: secondName }).first();
  await expect(row).toContainText(speakerName);
  await expect(row).toContainText(session.title);
  await expect(row).toContainText(taskTitle);
  const sessionScope = row.getByTestId("file-session-scope");
  const taskScope = row.getByTestId("file-task-scope");
  await expect(sessionScope.getByRole("link")).toHaveCount(sessionTitles.length);
  // Relational geometry rather than fixed pixel widths: at the evaluator's
  // viewport, every high-cardinality session link stays clipped to its own
  // column and the shared table container provides horizontal overflow.
  const layout = await row.evaluate((element) => {
    const sessionCell = element.querySelector<HTMLElement>("[data-testid=file-session-scope]")!;
    const taskCell = element.querySelector<HTMLElement>("[data-testid=file-task-scope]")!;
    const container = element.closest<HTMLElement>("[data-slot=table-container]")!;
    const sessionRect = sessionCell.getBoundingClientRect();
    const taskRect = taskCell.getBoundingClientRect();
    const links = [...sessionCell.querySelectorAll<HTMLElement>("a")];
    return {
      cellsDoNotOverlap: sessionRect.right <= taskRect.left + 0.5,
      linksStayInsideSessionCell: links.every((link) => {
        const rect = link.getBoundingClientRect();
        return rect.left >= sessionRect.left - 0.5 && rect.right <= sessionRect.right + 0.5;
      }),
      longLinksAreClipped: links.every(
        (link) => getComputedStyle(link).overflowX === "hidden",
      ),
      tableOverflow: getComputedStyle(container).overflowX,
    };
  });
  expect(layout).toEqual({
    cellsDoNotOverlap: true,
    linksStayInsideSessionCell: true,
    longLinksAreClipped: true,
    tableOverflow: "auto",
  });
  await expect(taskScope).toHaveText(taskTitle);
  const sessionHref = await row
    .getByRole("link", { name: session.title, exact: true })
    .getAttribute("href");
  expect(sessionHref).toMatch(new RegExp(`/admin/${isolatedEvent.slug}/agenda\\?session=`));

  // Session names are real navigation, not a generic count or tooltip. The
  // agenda detail links back into the same library with that session scoped,
  // giving organizers a session-to-files path in both directions.
  await row.getByRole("link", { name: session.title, exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: session.title })).toBeVisible();
  await page.getByRole("link", { name: "View related files" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${isolatedEvent.slug}/files\\?session=`));
  await expect(page.getByText(`Showing speaker-owned files related to ${session.title}.`)).toBeVisible();

  const scopedRow = page.getByRole("row").filter({ hasText: secondName }).first();
  await expect(
    scopedRow.getByRole("link", { name: session.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Show all files" })).toBeVisible();

  await expect(row).toContainText(`by ${speakerName}`);
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

  const headshotRow = page.getByRole("row").filter({ hasText: headshotName }).first();
  await expect(headshotRow).toContainText("Speaker profile");

  await expect(page.getByText("2 of 2 selected")).toBeVisible();
  await page.getByLabel(`Select ${headshotName}`).uncheck();
  await expect(page.getByText("1 of 2 selected")).toBeVisible();
  await page.getByLabel("Group folders by").selectOption("session");
  const downloadStarted = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "ZIP download started. Your browser will save it when it is ready.",
  );
  const download = await downloadStarted;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const archiveBody = Buffer.concat(chunks);
  const archive = unzipSync(new Uint8Array(archiveBody));
  const archivePaths = Object.keys(archive).sort();
  expect(archivePaths).toEqual(sessionTitles.map((title) => `${title}/${secondName}`).sort());
  expect(archivePaths.every((path) => !path.includes(firstName))).toBe(true);
  expect(archivePaths.every((path) => !path.includes(headshotName))).toBe(true);
  for (const contents of Object.values(archive)) {
    expect(Buffer.from(contents)).toEqual(SECOND_FILE);
  }

  await signIn(page, speakerEmail);
  await page.goto("/portal");
  task = await openTask(page, taskTitle);
  await expect(task.getByText(adminComment)).toBeVisible();
  await expect(task.getByText("Avery Chen")).toBeVisible();
});
