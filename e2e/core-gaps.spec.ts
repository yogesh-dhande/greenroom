import {
  addRoom,
  addSpeaker,
  addTrack,
  createDirectSession,
  createIsolatedEvent,
  createIsolatedForm,
  expect,
  publishForm,
  test,
} from "./fixtures";
import { devEmailsSince, signIn } from "./helpers";

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

test("publishing warns about unapproved content and every public surface follows the gate", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const track = `Track ${fixtureId}`;
  const room = `Room ${fixtureId}`;
  await addTrack(page, isolatedEvent.slug, track);
  await addRoom(page, isolatedEvent.slug, room);
  const session = await createDirectSession(page, isolatedEvent.slug, fixtureId, { track });

  // Direct-entry sessions start approved. Move this one back to editorial
  // draft, then schedule it so publish has a real held-back session to explain.
  await page.getByTestId("unscheduled-tray").getByText(session.title).click();
  await page.locator("#session-content-status").click();
  await page.getByRole("option", { name: "Draft", exact: true }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Session details saved")).toBeVisible();

  await page.getByTestId("unscheduled-tray").getByText(session.title).click();
  await page.locator("#session-day").click();
  await page.getByRole("option", { name: dayLabel(isolatedEvent.startDate) }).click();
  await page.locator("#session-room").click();
  await page.getByRole("option", { name: room, exact: true }).click();
  await page.locator("#session-start").fill("10:00");
  await page.getByRole("dialog").getByRole("button", { name: "Save time" }).click();

  for (const path of [`/p/${isolatedEvent.slug}`, `/embed/${isolatedEvent.slug}/schedule`]) {
    await page.goto(path);
    await expect(page.getByText(/program.*coming soon/i)).toBeVisible();
    await expect(page.getByText(session.title)).toHaveCount(0);
  }

  await page.goto(`/admin/${isolatedEvent.slug}`);
  await expect(page.getByTestId("publish-held-back-note")).toContainText(session.title);
  await page.getByRole("button", { name: "Publish program" }).click();
  const publishDialog = page.getByRole("alertdialog");
  await expect(publishDialog.getByTestId("publish-plan-summary")).toContainText(session.title);
  await publishDialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Program is live")).toBeVisible();
  await expect(page.getByTestId("publish-held-back-note")).toContainText(session.title);

  await page.goto(`/p/${isolatedEvent.slug}/schedule`);
  await expect(page.getByText(session.title)).toHaveCount(0);

  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${isolatedEvent.slug}/agenda`);
  await page.getByText(session.title).first().click();
  await page.locator("#session-content-status").click();
  await page.getByRole("option", { name: "Approved", exact: true }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Session details saved")).toBeVisible();

  await page.goto(`/p/${isolatedEvent.slug}/schedule`);
  await expect(page.getByText(session.title, { exact: true })).toBeVisible();
  await page.goto(`/embed/${isolatedEvent.slug}/schedule`);
  await expect(page.getByText(session.title, { exact: true })).toBeVisible();
  const feed = await page.request.get(`/p/${isolatedEvent.slug}/feed.ics`);
  expect(await feed.text()).toContain(session.title);

  // An already-published widget follows organizer edits immediately. The
  // snippet stays installed; there is no second publish/save-embed step.
  const updatedTitle = `Updated ${session.title}`;
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${isolatedEvent.slug}/agenda`);
  await page.getByText(session.title).first().click();
  await page.locator("#session-title").fill(updatedTitle);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Session details saved")).toBeVisible();

  await page.goto(`/p/${isolatedEvent.slug}/schedule`);
  await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(session.title, { exact: true })).toHaveCount(0);
  await page.goto(`/embed/${isolatedEvent.slug}/schedule`);
  await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible();
  const updatedFeed = await page.request.get(`/p/${isolatedEvent.slug}/feed.ics`);
  expect(await updatedFeed.text()).toContain(updatedTitle);

  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${isolatedEvent.slug}`);
  await page.getByRole("button", { name: "Unpublish program" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("Program is not published yet")).toBeVisible();
  await page.goto(`/p/${isolatedEvent.slug}/schedule`);
  await expect(page.getByText(/program.*coming soon/i)).toBeVisible();
  await expect(page.getByText(updatedTitle)).toHaveCount(0);
});

test("waitlisting is internal by default and the speaker still sees an unreviewed proposal", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const track = `Track ${fixtureId}`;
  const title = `Waitlist ${fixtureId}`;
  const email = `${fixtureId}@example.com`;
  await addTrack(page, isolatedEvent.slug, track);
  const form = await createIsolatedForm(page, isolatedEvent.slug, fixtureId);
  await publishForm(page, form);

  await page.context().clearCookies();
  await page.goto(form.publicPath);
  await page.getByLabel("Talk title").fill(title);
  await page.getByLabel("Abstract").fill("A proposal that remains in consideration.");
  await page.getByLabel(track).check();
  await page.getByLabel("Your name").fill(`Speaker ${fixtureId}`);
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("Speaker biography").fill("Builds systems that survive review queues.");
  await page.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("Proposal received", { exact: true })).toBeVisible();

  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${isolatedEvent.slug}/submissions`);
  await page.getByRole("link", { name: title }).click();
  const decisionAt = Date.now();
  await page.getByRole("button", { name: "Waitlist" }).click();
  const decision = page.getByRole("alertdialog");
  await expect(decision.getByLabel("Email the speakers")).not.toBeChecked();
  await expect(decision).toContainText("Internal only");
  await decision.getByRole("button", { name: "Confirm waitlist" }).click();
  await expect(page.getByTestId("decision-summary")).toContainText("Waitlisted");
  const decisionEmails = (await devEmailsSince(decisionAt)).filter((body) => body.includes(email));
  expect(decisionEmails).toHaveLength(0);

  await signIn(page, email);
  await page.goto("/portal");
  const proposal = page.getByRole("link").filter({ hasText: title });
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText("Unreviewed");
  await expect(page.getByText("Waitlisted")).toHaveCount(0);
  await expect(page.getByText("Maybe", { exact: true })).toHaveCount(0);
});

test("a reviewer can enter only assigned events and only the review workspace", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const assignedTrack = `Track ${fixtureId}`;
  const privateEvent = await createIsolatedEvent(page, `${fixtureId}-private`);
  await addTrack(page, isolatedEvent.slug, assignedTrack);

  await page.goto(`/admin/${isolatedEvent.slug}/team`);
  await page.getByLabel("Email").fill("dana@greenroom.dev");
  await page.getByRole("button", { name: "Add to team" }).click();
  const row = page.getByRole("row").filter({ hasText: "dana@greenroom.dev" });
  await row.getByRole("button", { name: "Edit tracks" }).click();
  await page.getByRole("checkbox", { name: assignedTrack }).click();
  await page.getByRole("button", { name: /^Save/ }).click();

  await signIn(page, "dana@greenroom.dev");
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: isolatedEvent.name })).toBeVisible();
  await expect(page.getByRole("link", { name: privateEvent.name })).toHaveCount(0);

  await page.goto(`/admin/${isolatedEvent.slug}`);
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Submissions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Review rounds" })).toBeVisible();
  for (const label of ["Agenda", "Speakers", "Tasks", "Forms", "Communications", "Team", "Settings"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }

  for (const route of ["agenda", "speakers", "tasks", "forms", "communications", "team", "settings"]) {
    await page.goto(`/admin/${isolatedEvent.slug}/${route}`);
    await expect(page).not.toHaveURL(new RegExp(`/${route}$`));
  }
  await page.goto(`/admin/${privateEvent.slug}`);
  await expect(page).not.toHaveURL(new RegExp(`/admin/${privateEvent.slug}$`));
});

test("session editing covers roster speakers, slot suggestions, editorial state, and restorable abstracts", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const track = `Track ${fixtureId}`;
  const room = `Room ${fixtureId}`;
  const extraSpeaker = `Extra ${fixtureId}`;
  const originalAbstract = `Original abstract ${fixtureId}`;
  const revisedAbstract = `Revised abstract ${fixtureId}`;
  await addTrack(page, isolatedEvent.slug, track);
  await addRoom(page, isolatedEvent.slug, room);
  await addSpeaker(page, isolatedEvent.slug, {
    name: extraSpeaker,
    email: `extra-${fixtureId}@example.com`,
  });
  const session = await createDirectSession(page, isolatedEvent.slug, fixtureId, {
    description: originalAbstract,
    track,
  });

  await page.getByTestId("unscheduled-tray").getByText(session.title).click();
  await page.getByLabel("Add a speaker from the roster").click();
  await page.getByRole("option", { name: new RegExp(extraSpeaker) }).click();
  await expect(page.getByRole("dialog").getByText(extraSpeaker, { exact: true })).toBeVisible();
  await page.getByTestId("suggest-slot").click();
  await expect(page.locator("#session-day")).not.toContainText("Unscheduled");
  await expect(page.locator("#session-room")).toContainText(room);
  await expect(page.locator("#session-start")).not.toHaveValue("");
  await page.getByRole("dialog").getByRole("button", { name: "Save time" }).click();

  await page.getByText(session.title).first().click();
  await page.locator("#session-description").fill(revisedAbstract);
  await page.locator("#session-content-status").click();
  await page.getByRole("option", { name: "In review", exact: true }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Session details saved")).toBeVisible();

  await page.getByText(session.title).first().click();
  await expect(page.locator("#session-description")).toHaveValue(revisedAbstract);
  await expect(page.locator("#session-content-status")).toContainText("In review");
  const history = page.getByTestId("revision-history");
  await expect(history).toContainText(originalAbstract);
  await history.getByTestId("restore-revision").first().click();
  await expect(page.getByText(`Earlier abstract restored on "${session.title}"`)).toBeVisible();

  await page.reload();
  await page.getByText(session.title).first().click();
  await expect(page.locator("#session-description")).toHaveValue(originalAbstract);
  await expect(page.getByTestId("revision-history").getByTestId("restore-revision")).toHaveCount(2);
  await expect(page.getByRole("dialog").getByText(extraSpeaker, { exact: true })).toBeVisible();
});
