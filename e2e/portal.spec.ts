import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: the speaker portal and onboarding tasks (spec.md §6, §8).
 *
 * A speaker sees their events/submissions/sessions/tasks in one place and
 * completes tasks from it — using the six canonical onboarding examples from
 * the organizer's reference video (hotel stay and flight reimbursement are
 * the "must-have" structured-form tasks; the rest are confirm/upload) — an
 * admin sees the same progress roll up on the onboarding dashboard, and one
 * speaker never sees another's submissions, sessions, or task answers.
 *
 * Runs against the seeded demo database. Tests run in file order on one
 * worker and build on each other's state.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const TASKS_PAGE = `/admin/${EVENT_SLUG}/tasks`;
const SPEAKERS_PAGE = `/admin/${EVENT_SLUG}/speakers`;
const PUBLIC_SPEAKERS_PAGE = `/p/${EVENT_SLUG}/speakers`;

/** Seeded speaker with an approved, scheduled talk — has a pending "form"
 * task (hotel) and a pending "file_request" task (bio & photos) to complete. */
const PRIYA = "priya.raman@example.com";
const PRIYA_TALK = "Retrieval that survives production traffic";
/** A second speaking speaker, used only to prove no cross-speaker leakage. */
const TOM = "tom.beckett@example.com";
const TOM_TALK = "Cutting inference spend by 80% without touching quality";

const HOTEL_TASK = "Hotel stay requirement form";
const FLIGHT_TASK = "Flight reimbursement form";
const FINALIZE_DESCRIPTION_TASK = "Finalize talk description";
const FINALIZE_BIO_TASK = "Finalize bio & photos";
const ANNOUNCE_TASK = "Announce participation";
const INVITE_TASK = "Invite colleagues with speaker discount";

/** A tiny but valid PNG, so the upload exercises the real R2 path (mirrors
 * e2e/cfp.spec.ts's headshot upload). */
const HEADSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Each task renders as a disclosure row labelled by its title (role
 * "group", with a real button trigger since the W29 a11y fix) — scopes a
 * locator so two "form" tasks' identical "Submit" buttons (or two speakers'
 * identically-titled tasks) don't collide. */
function taskRegion(page: import("@playwright/test").Page, title: string) {
  return page.getByRole("group", { name: title });
}

/** Tasks start collapsed (only the next-due one opens itself), and a
 * collapsed task hides its controls — expand before interacting. The
 * trigger is the group's first button, carrying aria-expanded. */
async function openTask(page: import("@playwright/test").Page, title: string) {
  const region = taskRegion(page, title);
  const trigger = region.locator('button[aria-expanded]').first();
  if ((await trigger.getAttribute("aria-expanded")) === "false") {
    await trigger.click();
  }
  return region;
}

test("a speaker signs in and sees their onboarding tasks", async ({ page }) => {
  await signIn(page, PRIYA);
  await page.goto("/portal");

  await expect(page.getByRole("heading", { name: "Your speaker home" })).toBeVisible();
  await expect(page.getByRole("link", { name: PRIYA_TALK })).toBeVisible();

  // All six canonical task templates auto-assigned on acceptance.
  for (const title of [
    HOTEL_TASK,
    FLIGHT_TASK,
    FINALIZE_DESCRIPTION_TASK,
    FINALIZE_BIO_TASK,
    ANNOUNCE_TASK,
    INVITE_TASK,
  ]) {
    await expect(taskRegion(page, title)).toBeVisible();
  }

  // Seeded pending for Priya, due comfortably in the future: open, not done.
  await expect(taskRegion(page, HOTEL_TASK)).toContainText("Open");
  // Seeded pending for Priya, due in two days: inside the due-soon window.
  await expect(taskRegion(page, FINALIZE_BIO_TASK)).toContainText("Due soon");
  // Seeded already completed for Priya at seed time.
  await expect(taskRegion(page, ANNOUNCE_TASK)).toContainText("Complete");
});

test("a speaker completes a form task and a file task, and it reflects on the admin onboarding dashboard", async ({
  page,
}) => {
  await signIn(page, PRIYA);
  await page.goto("/portal");

  // --- the "hotel stay" must-have: a structured form, not a plain upload ---
  const hotel = await openTask(page, HOTEL_TASK);
  await hotel.getByLabel("Do you need us to book your hotel room?").click();
  await page.getByRole("option", { name: "Yes, book me a room" }).click();
  await hotel.getByLabel("Check-in date (YYYY-MM-DD)").fill("2026-08-10");
  await hotel.getByLabel("Check-out date (YYYY-MM-DD)").fill("2026-08-13");
  await hotel.getByLabel("Room preference").click();
  await page.getByRole("option", { name: "One queen bed" }).click();
  await hotel.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Saved — thanks!")).toBeVisible();
  await expect(hotel).toContainText("Complete");

  // --- "finalize bio & photos": the file-upload task type ---
  const bio = await openTask(page, FINALIZE_BIO_TASK);
  await bio.getByLabel("Upload a file").setInputFiles({
    name: "headshot.png",
    mimeType: "image/png",
    buffer: HEADSHOT,
  });
  // The upload itself happens on selection, straight to R2; wait for the
  // key to come back before submitting the (otherwise empty) form.
  await expect(bio.getByRole("link", { name: "headshot.png" })).toBeVisible();
  await bio.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Uploaded — thanks!")).toBeVisible();
  await expect(bio).toContainText("Complete");
  // Completion re-renders the row collapsed (only the next due task starts
  // open), so reopen it to reach the uploaded-file link.
  await openTask(page, FINALIZE_BIO_TASK);
  const uploaded = bio.getByRole("link", { name: "View what you uploaded" });
  await expect(uploaded).toBeVisible();
  const fileHref = await uploaded.getAttribute("href");
  const served = await page.request.get(fileHref!);
  expect(served.status()).toBe(200);

  // --- the admin onboarding dashboard picks both up without a manual step ---
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS_PAGE);
  const row = page.getByRole("row", { name: /Priya Raman/ });
  await expect(row).toContainText("6 of 6 tasks complete");
  // Task titles live on as each square's accessible name, alongside its state.
  await expect(row.getByRole("img", { name: `${HOTEL_TASK} — Complete` })).toBeVisible();
  await expect(row.getByRole("img", { name: `${FINALIZE_BIO_TASK} — Complete` })).toBeVisible();
  // No overdue tasks left for Priya (the "0" case renders as an em dash).
  await expect(row).toContainText("—");
});

test("the portal denies access to another speaker's materials", async ({ page }) => {
  // Priya's submission/session titles are invisible on Tom's portal, and vice
  // versa — listBySpeaker really scopes to the signed-in user, not the event.
  await signIn(page, TOM);
  await page.goto("/portal");
  await expect(page.getByRole("link", { name: TOM_TALK })).toBeVisible();
  await expect(page.getByText(PRIYA_TALK)).toHaveCount(0);

  // A stranger can't reach Priya's submission by URL either (existing
  // /portal/submissions/[id] ownership check, exercised here end-to-end
  // through a task-adjacent flow rather than rebuilt).
  await signIn(page, PRIYA);
  await page.goto("/portal");
  const priyaSubmissionHref = await page.getByRole("link", { name: PRIYA_TALK }).getAttribute("href");

  await signIn(page, TOM);
  const response = await page.goto(priyaSubmissionHref!);
  expect(response?.status()).toBe(404);

  // A third speaker (untouched by the earlier completion test) has her own,
  // independent assignment for the same "hotel" task template. Which named
  // speaker the seed leaves with a *pending* hotel task isn't stable across
  // reseeds — co-speaker enumeration order in the seed script depends on a
  // DB read with no explicit ORDER BY (see learnings.md) — so we discover
  // one live rather than hardcode a name. Whichever speaker we land on, her
  // task must not carry the check-in date Priya just submitted for her own
  // assignment: each TaskAssignment row is per speaker, never shared.
  const otherSpeakers = [
    "aisha.n@example.com",
    "l.fernandez@example.com",
    "hannah.kim@example.com",
    "d.oyelaran@example.com",
    "sofia.rossi@example.com",
  ];
  let foundOpenHotelTask = false;
  for (const email of otherSpeakers) {
    await signIn(page, email);
    await page.goto("/portal");
    const stillOpen =
      ((await taskRegion(page, HOTEL_TASK).textContent())?.includes("Open")) ?? false;
    if (!stillOpen) continue;
    foundOpenHotelTask = true;
    const herHotel = await openTask(page, HOTEL_TASK);
    await herHotel.getByLabel("Do you need us to book your hotel room?").click();
    await page.getByRole("option", { name: "Yes, book me a room" }).click();
    await expect(herHotel.getByLabel("Check-in date (YYYY-MM-DD)")).toHaveValue("");
    break;
  }
  expect(foundOpenHotelTask).toBe(true);
});

test("an admin creates a task template using the canonical onboarding vocabulary", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(TASKS_PAGE);

  // All six canonical templates are already there from seeding.
  for (const title of [
    HOTEL_TASK,
    FLIGHT_TASK,
    FINALIZE_DESCRIPTION_TASK,
    FINALIZE_BIO_TASK,
    ANNOUNCE_TASK,
    INVITE_TASK,
  ]) {
    await expect(page.getByRole("cell", { name: title, exact: true })).toBeVisible();
  }

  // An admin can define another one for a later track of the same event,
  // reusing the same canonical vocabulary the organizer gave us. Auto-assign
  // is switched off for this one — it's a second-cohort variant, not meant
  // to land on every speaker who's already been accepted (also keeps this
  // test from changing the auto-assigned task count other e2e specs check).
  await expect(page.getByRole("cell", { name: INVITE_TASK, exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title").fill(INVITE_TASK);
  await page.getByLabel("Instructions (optional)").fill(
    "Second cohort — share your speaker discount code with colleagues, then confirm you've sent it.",
  );
  await page.getByRole("switch", { name: "Auto-assign on acceptance" }).click();
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();
  await expect(page.getByRole("cell", { name: INVITE_TASK, exact: true })).toHaveCount(2);
});

test("a speaker edits their profile and it surfaces on the public gallery and admin roster", async ({
  page,
}) => {
  // spec.md §6: a speaker "edits their own profile (name, title, company, bio,
  // social/web links) and headshot, which feed the admin roster and public
  // gallery" — so this walks the whole chain, not just the form.
  const NEW_TITLE = "Principal Engineer, Retrieval";
  const NEW_COMPANY = "Northwind Labs";
  // Distinctive enough that finding it on the public page proves it came from
  // this edit and not from the seeded bio.
  const NEW_BIO = "Rebuilt ranking for a fleet of grumpy production indexes.";
  const NEW_WEBSITE = "https://priya-raman.example.dev";

  await signIn(page, PRIYA);
  await page.goto("/portal/profile");
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();

  await page.getByLabel("Job title").fill(NEW_TITLE);
  await page.getByLabel("Company or organization").fill(NEW_COMPANY);
  await page.getByLabel("Speaker bio").fill(NEW_BIO);
  await page.getByLabel("Website").fill(NEW_WEBSITE);

  // The headshot goes straight to R2 on selection (same control as the CFP
  // page and the file-request task above), so wait for the key before saving.
  await page.getByLabel("Headshot").setInputFiles({
    name: "headshot.png",
    mimeType: "image/png",
    buffer: HEADSHOT,
  });
  await expect(page.getByRole("link", { name: "headshot.png" })).toBeVisible();

  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  // --- it really persisted, not just optimistic form state -----------------
  await page.reload();
  await expect(page.getByLabel("Job title")).toHaveValue(NEW_TITLE);
  await expect(page.getByLabel("Company or organization")).toHaveValue(NEW_COMPANY);
  await expect(page.getByLabel("Speaker bio")).toHaveValue(NEW_BIO);
  await expect(page.getByLabel("Website")).toHaveValue(NEW_WEBSITE);
  // The stored headshot is now the uploaded one, served back out of R2.
  const preview = page.getByRole("img", { name: "Your current headshot" });
  await expect(preview).toHaveAttribute("src", /^\/files\/uploads\/profile\//);
  const served = await page.request.get((await preview.getAttribute("src"))!);
  expect(served.status()).toBe(200);

  // A link that isn't a real link is refused, with the message under its own
  // input rather than a generic failure. (The same rule runs again in the
  // server action — src/domain/profile.ts — so a client bypass can't store it.)
  await page.getByLabel("LinkedIn").fill("linkedin.com/in/priya");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Enter a full link, starting with https://")).toBeVisible();

  // --- the public speaker gallery shows the new bio and link ---------------
  await page.goto(PUBLIC_SPEAKERS_PAGE);
  const card = page.getByRole("article").filter({ hasText: "Priya Raman" });
  await expect(card).toContainText(NEW_BIO);
  await expect(card).toContainText(`${NEW_TITLE} · ${NEW_COMPANY}`);
  await expect(card.getByRole("link", { name: "Priya Raman — Website" })).toHaveAttribute(
    "href",
    NEW_WEBSITE,
  );

  // --- and the admin roster reads the same source of truth -----------------
  await signIn(page, "admin@greenroom.dev");
  await page.goto(SPEAKERS_PAGE);
  const row = page.getByRole("row", { name: /Priya Raman/ });
  await expect(row).toContainText(`${NEW_TITLE} · ${NEW_COMPANY}`);
  await expect(row).toContainText("Complete");
});
