import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: the org-level speaker CRM (spec.md "Org-level speaker CRM",
 * decisions.md D-077) — directory search/filter composition, manual contact
 * creation, tags + internal notes, dynamic saved segments, the sourcing
 * pipeline (enroll, explicit stage moves, stage history), add-to-event
 * carrying the profile onto a roster, bulk outreach landing on the activity
 * feed, and the CRM overview.
 *
 * Tests run in order and build on one shared contact, Nova Delacroix — a
 * name and company no other spec or seed row uses, so nothing here disturbs
 * the roster/portal/comms fixtures (this file runs before portal/speakers in
 * the alphabetical single-worker order, and Nova matches none of their
 * filters).
 */

const DIRECTORY = "/admin/directory";
const NOVA = "Nova Delacroix";
const NOVA_EMAIL = "nova.delacroix@example.com";
const NOVA_COMPANY = "Lumen Stageworks";
const NOTE_TEXT = "Met at DevFlow 2026 - strong on CI topics; shortlist for keynote.";
const EMAIL_SUBJECT = "Keynote for DevFlow Conf 2027?";

async function openNovaProfile(page: Page) {
  await page.goto(`${DIRECTORY}?q=Nova`);
  await page.getByRole("link", { name: NOVA }).click();
  await expect(page.getByRole("heading", { name: NOVA })).toBeVisible();
}

test("the admin dashboard links into the cross-event directory", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto("/admin");

  await page.getByRole("link", { name: /Speaker CRM/ }).click();
  await expect(page).toHaveURL(/\/admin\/directory$/);
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();

  // Speakers from the event roster appear with no CRM-side setup — identity
  // is global by email (D-051), the directory just surfaces it.
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toBeVisible();
});

test("directory search composes with the company filter and clears in one action", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  // The search box debounces before pushing to the URL; the server filters.
  await page.getByLabel("Search contacts").fill("Raman");
  await expect(page).toHaveURL(/q=Raman/);
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toHaveCount(0);

  // Both criteria must survive into the URL and AND together in the rows.
  await page.getByLabel("Filter by company").click();
  await page.getByRole("option", { name: "Northwind Labs" }).click();
  await expect(page).toHaveURL(/company=Northwind/);
  await expect(page).toHaveURL(/q=Raman/);
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/q=|company=/);
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toBeVisible();
});

test("a hand-added contact takes tags and notes that survive reload", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  await page.getByRole("button", { name: "Add contact" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(NOVA);
  await dialog.getByLabel("Email").fill(NOVA_EMAIL);
  await dialog.getByLabel("Title (optional)").fill("Lighting Director");
  await dialog.getByLabel("Company (optional)").fill(NOVA_COMPANY);
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText(`${NOVA} was added to the directory`)).toBeVisible();

  await page.getByRole("link", { name: NOVA }).click();
  await expect(page.getByRole("heading", { name: NOVA })).toBeVisible();

  // Tags normalize server-side; the toast echoes the stored casing.
  await page.getByLabel("Add tag").fill("vip");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText('Tagged "vip"')).toBeVisible();

  await page.getByLabel("Internal note").fill(NOTE_TEXT);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added")).toBeVisible();

  // Both writes are rows, not client state: still there on a fresh render,
  // and the note doubles as the first activity-feed entry.
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove tag vip" })).toBeVisible();
  await expect(page.getByText(NOTE_TEXT).first()).toBeVisible();
});

test("a saved segment is dynamic — it reopens as its stored criteria", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  await page.getByLabel("Filter by tag").click();
  await page.getByRole("option", { name: "vip" }).click();
  await expect(page).toHaveURL(/tag=vip/);
  await expect(page.getByRole("link", { name: NOVA })).toBeVisible();
  await expect(page.getByRole("link", { name: "Priya Raman" })).toHaveCount(0);

  await page.getByRole("button", { name: "Save segment" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("1 contact matches right now.")).toBeVisible();
  await dialog.getByLabel("Segment name").fill("VIP Prospects");
  await dialog.getByRole("button", { name: "Save segment" }).click();
  await expect(page.getByText('Saved the segment "VIP Prospects"')).toBeVisible();

  // Reopening from a clean directory applies the criteria, not a stored list.
  await page.goto(DIRECTORY);
  await page.getByRole("link", { name: "VIP Prospects" }).click();
  await expect(page).toHaveURL(/segment=/);
  await expect(page.getByText("Segment", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: NOVA })).toBeVisible();
  await expect(page.getByRole("link", { name: "Priya Raman" })).toHaveCount(0);

  await page.getByRole("link", { name: "Clear segment" }).click();
  await expect(page).not.toHaveURL(/segment=/);
  await expect(page.getByRole("link", { name: "Priya Raman" })).toBeVisible();
});

test("pipeline: enroll a prospect, move stages explicitly, history persists", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto("/admin/pipeline");

  const identified = page.getByRole("region", { name: "Identified stage" });
  const contacted = page.getByRole("region", { name: "Contacted stage" });
  const interested = page.getByRole("region", { name: "Interested stage" });

  await page.getByRole("button", { name: "Add prospect" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Contact", { exact: true })
    .selectOption({ label: `${NOVA} (${NOVA_EMAIL})` });
  await dialog.getByLabel("Score (optional)").fill("85");
  await dialog
    .getByLabel("Rationale (optional)")
    .fill("Ran the best-attended workshop last season.");
  await dialog.getByRole("button", { name: "Add prospect" }).click();
  await expect(page.getByText(`${NOVA} added to Identified`)).toBeVisible();
  await expect(identified.getByRole("link", { name: NOVA })).toBeVisible();
  await expect(identified.getByText("Score 85")).toBeVisible();

  // The explicit control is the only mover (no drag, by design — D-077).
  await identified.getByRole("button", { name: "Move to" }).click();
  await page.getByRole("menuitem", { name: "Contacted" }).click();
  await expect(page.getByText("Moved to Contacted")).toBeVisible();
  await expect(contacted.getByRole("link", { name: NOVA })).toBeVisible();
  await expect(identified.getByText("No prospects")).toBeVisible();

  await contacted.getByRole("button", { name: "Move to" }).click();
  await page.getByRole("menuitem", { name: "Interested" }).click();
  await expect(page.getByText("Moved to Interested")).toBeVisible();

  // Stage is a stored fact, not view state.
  await page.reload();
  await expect(interested.getByRole("link", { name: NOVA })).toBeVisible();

  await interested.getByRole("link", { name: NOVA }).click();
  await expect(page.getByRole("heading", { name: NOVA })).toBeVisible();
  await expect(page.getByText("Score 85")).toBeVisible();
  await expect(page.getByText("Ran the best-attended workshop last season.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open contact profile" })).toBeVisible();

  // Every hop was recorded, oldest enrollment included.
  await expect(page.getByText("Enrolled as Identified")).toBeVisible();
  await expect(page.getByText("Identified -> Contacted")).toBeVisible();
  await expect(page.getByText("Contacted -> Interested")).toBeVisible();

  await page.getByLabel("Add note").fill("Prefers a morning slot.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added")).toBeVisible();
  await expect(page.getByText("Prefers a morning slot.")).toBeVisible();
});

test("add to event puts the contact on the roster with their profile carried over", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await openNovaProfile(page);

  await page.getByRole("button", { name: "Add to event" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Event").click();
  await page.getByRole("option", { name: /AI Engineer Summit 2026/ }).click();
  await dialog.getByRole("button", { name: "Add to event" }).click();
  await expect(page.getByText(`${NOVA} was added to AI Engineer Summit 2026`)).toBeVisible();

  // The profile now shows the connection...
  await expect(page.getByRole("link", { name: "AI Engineer Summit 2026" })).toBeVisible();
  await expect(page.getByText("On the roster, no session yet")).toBeVisible();

  // ...and the event roster shows the person, company intact with no
  // re-entry, because roster and profile read the same record (D-051).
  await page.goto("/admin/ai-engineer-summit-2026/speakers");
  await page.getByLabel("Search speakers").fill("Nova");
  await expect(page).toHaveURL(/q=Nova/);
  await expect(page.getByRole("link", { name: NOVA })).toBeVisible();
  await expect(page.getByText(NOVA_COMPANY)).toBeVisible();
});

test("bulk email from the directory lands on the contact's activity feed", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`${DIRECTORY}?q=Nova`);

  await page.getByLabel(`Select ${NOVA}`).click();
  await page.getByRole("button", { name: "Email selected (1)" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`Recipients (1)`)).toBeVisible();
  await dialog.getByLabel("Subject").fill(EMAIL_SUBJECT);
  await dialog
    .getByLabel("Message")
    .fill("Hi {{speakerFirstName}},\n\nWould you keynote our next event?");
  await dialog.getByRole("button", { name: "Send to 1 person" }).click();
  await expect(page.getByText("Sent to 1 person")).toBeVisible();
  await expect(dialog.getByText("Sent to 1 contact")).toBeVisible();
  await page.keyboard.press("Escape");

  // Sends are logged per recipient, so the profile's feed picks it up.
  await openNovaProfile(page);
  await expect(page.getByText(EMAIL_SUBJECT)).toBeVisible();
});

test("the CRM overview reflects the pipeline built above", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto("/admin/crm");

  await expect(page.getByRole("heading", { name: "Speaker CRM overview" })).toBeVisible();
  await expect(page.getByText("Total contacts")).toBeVisible();
  await expect(page.getByText("In pipeline")).toBeVisible();

  // Nova is the only card on the board, sitting in Interested; the stage
  // widget must agree with the board it links to.
  await expect(page.getByRole("link", { name: "Interested 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Identified 0" })).toBeVisible();
});
