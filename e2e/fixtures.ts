import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { signIn } from "./helpers";

export interface IsolatedEvent {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
}

export interface IsolatedForm {
  name: string;
  id: string;
  slug: string;
  builderPath: string;
  publicPath: string;
}

export interface IsolatedSession {
  title: string;
  speakerName: string;
  speakerEmail: string;
}

interface GreenroomFixtures {
  fixtureId: string;
  isolatedEvent: IsolatedEvent;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * A stable identity for one Playwright test attempt. Tests use it in slugs,
 * email addresses and titles so their rows cannot collide with seeded data or
 * with another scenario. The retry suffix matters because retries share the
 * same once-per-run local database.
 */
function fixtureIdFor(testInfo: TestInfo): string {
  const title = testInfo.titlePath.join(" ");
  return `${slugPart(testInfo.title)}-${shortHash(title)}-r${testInfo.retry}`;
}

function dateFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Creates an event exclusively for the calling test through the public UI. */
export async function createIsolatedEvent(page: Page, fixtureId: string): Promise<IsolatedEvent> {
  const name = `E2E ${fixtureId}`;
  const slug = `e2e-${fixtureId}`.slice(0, 64).replace(/-+$/g, "");
  const startDate = dateFromNow(90);
  const endDate = dateFromNow(91);

  await signIn(page, "admin@greenroom.dev");
  await page.goto("/admin/new");
  await page.getByLabel("Event name").fill(name);
  await page.getByLabel("URL slug").fill(slug);
  await page.getByLabel("Start date").fill(startDate);
  await page.getByLabel("End date").fill(endDate);
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));

  return { name, slug, startDate, endDate };
}

/** Creates one form owned only by the calling test and leaves it unpublished. */
export async function createIsolatedForm(
  page: Page,
  eventSlug: string,
  fixtureId: string,
  options: { name?: string; type?: "abstract" | "session" } = {},
): Promise<IsolatedForm> {
  const name = options.name ?? `Form ${fixtureId}`;
  await page.goto(`/admin/${eventSlug}/forms`);
  // The responsive forms page renders the same trigger in its populated and
  // empty-state layouts; either opens the same dialog, so choose one
  // deterministically instead of relying on strict-mode uniqueness.
  await page.getByRole("button", { name: "New form" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New form" });
  await dialog.getByLabel("Form name").fill(name);
  if (options.type === "session") {
    const type = dialog.locator("#new-form-type");
    await type.click();
    await page.getByRole("option", { name: "Session", exact: true }).click();
    await expect(type).toContainText("Session");
  }
  await dialog.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  const builderPath = new URL(page.url()).pathname;
  const id = builderPath.split("/").pop()!;
  const slug = `form-${fixtureId}`.slice(0, 64).replace(/-+$/g, "");

  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Public link").fill(slug);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Form saved")).toBeVisible();
  await page.getByRole("tab", { name: "Questions" }).click();

  return { name, id, slug, builderPath, publicPath: `/submit/${slug}` };
}

export async function addTrack(page: Page, eventSlug: string, name: string): Promise<void> {
  await page.goto(`/admin/${eventSlug}/settings`);
  await page.getByRole("button", { name: "Add track" }).click();
  const dialog = page.getByRole("dialog", { name: "Add track" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add track" }).click();
  await expect(page.getByText("Track added")).toBeVisible();
}

export async function addRoom(
  page: Page,
  eventSlug: string,
  name: string,
  capacity = "100",
): Promise<void> {
  await page.goto(`/admin/${eventSlug}/settings`);
  await page.getByRole("button", { name: "Add room" }).click();
  const dialog = page.getByRole("dialog", { name: "Add room" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Capacity").fill(capacity);
  await dialog.getByRole("button", { name: "Add room" }).click();
  await expect(page.getByText("Room added")).toBeVisible();
}

export async function addSpeaker(
  page: Page,
  eventSlug: string,
  person: { name: string; email: string; title?: string; company?: string; bio?: string },
): Promise<void> {
  await page.goto(`/admin/${eventSlug}/speakers`);
  await page.getByRole("button", { name: "Add speaker" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(person.name);
  await dialog.getByLabel("Email", { exact: true }).fill(person.email);
  if (person.title) await dialog.getByLabel("Title (optional)").fill(person.title);
  if (person.company) await dialog.getByLabel("Company (optional)").fill(person.company);
  if (person.bio) await dialog.getByLabel("Bio (optional)").fill(person.bio);
  await dialog.getByRole("button", { name: "Add speaker" }).click();
  await expect(page.getByText(`${person.name} was added to the roster`)).toBeVisible();
}

/** Creates an unscheduled direct-entry session with a brand-new speaker. */
export async function createDirectSession(
  page: Page,
  eventSlug: string,
  fixtureId: string,
  options: { title?: string; description?: string; track?: string } = {},
): Promise<IsolatedSession> {
  const title = options.title ?? `Session ${fixtureId}`;
  const speakerName = `Speaker ${fixtureId}`;
  const speakerEmail = `${fixtureId}@example.com`;

  await page.goto(`/admin/${eventSlug}/agenda`);
  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog", { name: "New session" });
  await dialog.locator("#new-session-title").fill(title);
  await dialog
    .locator("#new-session-description")
    .fill(options.description ?? `Description for ${title}`);
  if (options.track) {
    await dialog.locator("#new-session-track").click();
    await page.getByRole("option", { name: options.track, exact: true }).click();
  }
  await dialog.locator("#new-speaker-name").fill(speakerName);
  await dialog.getByLabel("Email", { exact: true }).fill(speakerEmail);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText(speakerName)).toBeVisible();
  await dialog.getByRole("button", { name: "Create session" }).click();
  // The first direct-session action in a dev-server run can spend more than
  // Playwright's default five seconds compiling and streaming the revalidated
  // agenda. The product keeps this action pending for up to 15 seconds before
  // showing its explicit timeout recovery, so let the success assertion use
  // that same bound instead of declaring a completed write failed early.
  await expect(page.getByText("Session added to the unscheduled tray")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("unscheduled-tray").getByText(title)).toBeVisible();

  return { title, speakerName, speakerEmail };
}

/** Creates one unassigned task which only the calling test names or assigns. */
export async function createTask(
  page: Page,
  eventSlug: string,
  title: string,
  type: "confirm" | "file" | "form" = "confirm",
): Promise<void> {
  await page.goto(`/admin/${eventSlug}/tasks`);
  await page.getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  if (type !== "confirm") {
    await dialog.getByLabel("Type", { exact: true }).click();
    await page
      .getByRole("option", { name: type === "file" ? "Upload a file" : "Fill out a form" })
      .click();
  }
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();
}

export async function publishForm(
  page: Page,
  form: IsolatedForm,
  closesAt = "2027-12-31T17:00",
): Promise<void> {
  await page.goto(form.builderPath);
  await page.getByRole("tab", { name: "Window & link" }).click();
  await page.getByLabel("Closes").fill(closesAt);
  await page.getByRole("button", { name: "Save & publish" }).click();
  await expect(page.getByText("Form published")).toBeVisible();
}

export const test = base.extend<GreenroomFixtures>({
  fixtureId: async ({}, provide, testInfo) => {
    await provide(fixtureIdFor(testInfo));
  },
  isolatedEvent: async ({ page, fixtureId }, provide) => {
    await provide(await createIsolatedEvent(page, fixtureId));
  },
});

export { expect };
