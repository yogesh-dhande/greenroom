import { expect, test, type Page } from "@playwright/test";
import { devEmailsSince, signIn } from "./helpers";

/**
 * Key flow: the org-level speaker CRM (spec.md "Org-level speaker CRM",
 * decisions.md D-077) — directory search/filter composition, manual contact
 * creation, tags + internal notes, dynamic saved segments, the sourcing
 * pipeline (enroll, explicit stage moves, stage history), add-to-event
 * carrying the profile onto a roster, bulk outreach landing on the activity
 * feed, and the CRM overview.
 *
 * Nova's full contact-to-pipeline lifecycle is one scenario. Independent CRM
 * assertions create their own contacts, so no test relies on file ordering.
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

test("bulk outreach personalizes and logs a separate message for every selected contact", async ({
  page,
}) => {
  const startedAt = Date.now();
  const subject = `Speak at our next event? ${startedAt.toString(36)}`;
  const recipients = ["priya.raman@example.com", "hannah.kim@example.com"];

  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);
  await page.getByLabel("Select Priya Raman").click();
  await page.getByLabel("Select Hannah Kim").click();
  await page.getByRole("button", { name: "Email selected (2)" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Recipients (2)")).toBeVisible();
  await dialog.getByLabel("Subject").fill(subject);
  await dialog.getByLabel("Message").fill("Hi {{speakerFirstName}}, please join us.");
  await dialog.getByRole("button", { name: "Send to 2 people" }).click();
  await expect(dialog.getByText("Sent to 2 contacts")).toBeVisible();
  await expect(dialog.getByText("Nobody picked yet.")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Send to 0 people" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Done" })).toBeVisible();

  await expect(async () => {
    const messages = (await devEmailsSince(startedAt)).filter((body) => body.includes(subject));
    expect(messages).toHaveLength(2);
    expect(messages.map((body) => body.match(/^To: (.+)$/m)?.[1]).sort()).toEqual(
      recipients.sort(),
    );
    expect(messages.some((body) => body.includes("Hi Priya,"))).toBe(true);
    expect(messages.some((body) => body.includes("Hi Hannah,"))).toBe(true);
    expect(messages.every((body) => !body.includes("{{speakerFirstName}}"))).toBe(true);
  }).toPass({ timeout: 15_000 });
});

test("an isolated contact runs through profile, segment, pipeline, roster, outreach, and overview", async ({
  page,
}) => {
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
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  await page.getByLabel("Filter by tag").click();
  await page.getByRole("option", { name: "vip" }).click();
  await expect(page).toHaveURL(/tag=vip/);
  await expect(page.getByRole("link", { name: NOVA })).toBeVisible();
  await expect(page.getByRole("link", { name: "Priya Raman" })).toHaveCount(0);

  await page.getByRole("button", { name: "Save segment" }).click();
  const segmentDialog = page.getByRole("dialog");
  await expect(segmentDialog.getByText("1 contact matches right now.")).toBeVisible();
  await segmentDialog.getByLabel("Segment name").fill("VIP Prospects");
  await segmentDialog.getByRole("button", { name: "Save segment" }).click();
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
  await signIn(page, "admin@greenroom.dev");
  await page.goto("/admin/pipeline");

  const identified = page.getByRole("region", { name: "Identified stage" });
  const contacted = page.getByRole("region", { name: "Contacted stage" });
  const interested = page.getByRole("region", { name: "Interested stage" });

  await page.getByRole("button", { name: "Add prospect" }).click();
  const prospectDialog = page.getByRole("dialog");
  await prospectDialog
    .getByLabel("Contact", { exact: true })
    .selectOption({ label: `${NOVA} (${NOVA_EMAIL})` });
  await prospectDialog.getByLabel("Score (optional)").fill("85");
  await prospectDialog
    .getByLabel("Rationale (optional)")
    .fill("Ran the best-attended workshop last season.");
  await prospectDialog.getByRole("button", { name: "Add prospect" }).click();
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
  await signIn(page, "admin@greenroom.dev");
  await openNovaProfile(page);

  await page.getByRole("button", { name: "Add to event" }).click();
  const eventDialog = page.getByRole("dialog");
  await eventDialog.getByRole("combobox", { name: "Event", exact: true }).click();
  await page.getByRole("option", { name: /AI Engineer Summit 2026/ }).click();
  await eventDialog.getByRole("button", { name: "Add to event" }).click();
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
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`${DIRECTORY}?q=Nova`);

  await page.getByLabel(`Select ${NOVA}`).click();
  await page.getByRole("button", { name: "Email selected (1)" }).click();

  const outreachDialog = page.getByRole("dialog");
  await expect(outreachDialog.getByText(`Recipients (1)`)).toBeVisible();
  await outreachDialog.getByLabel("Subject").fill(EMAIL_SUBJECT);
  await outreachDialog
    .getByLabel("Message")
    .fill("Hi {{speakerFirstName}},\n\nWould you keynote our next event?");
  await outreachDialog.getByRole("button", { name: "Send to 1 person" }).click();
  await expect(page.getByText("Sent to 1 person")).toBeVisible();
  await expect(outreachDialog.getByText("Sent to 1 contact")).toBeVisible();
  await outreachDialog.getByRole("button", { name: "Done" }).click();

  // Sends are logged per recipient, so the profile's feed picks it up.
  await openNovaProfile(page);
  await expect(page.getByText(EMAIL_SUBJECT)).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: EMAIL_SUBJECT }),
  ).toContainText("UTC");
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

// ---------------------------------------------------------------------------
// Dedup + pipeline-card coverage (spec.md "Org-level speaker CRM": duplicate
// adds are rejected outright before creation; add-to-event works from a
// profile *or* a pipeline card). Fresh fixture names throughout (Padma
// Rannveig, Wren Calloway, Isolde Bramblewood, Quill Farrowmere) — they match
// no other spec's filters, and these run after the overview test above, whose
// exact stage counts a new pipeline card would otherwise break.
// ---------------------------------------------------------------------------

// Seeded, event-connected speaker (scripts/seed.ts SPEAKER_SEEDS[0]): Priya
// speaks at AI Engineer Summit 2026, so she is in the directory via the
// speaker union, not a registry row — the exact case the dedup fix covers.
const PRIYA_EMAIL = "priya.raman@example.com";
// Seeded speaker used as the CSV duplicate row (SPEAKER_SEEDS[4]).
const HANNAH_EMAIL = "hannah.kim@example.com";

const WREN = "Wren Calloway";
const WREN_EMAIL = "wren.calloway@example.com";
const WREN_SECOND_EMAIL = "wren.calloway.brightside@example.com";

const ISOLDE = "Isolde Bramblewood";
const ISOLDE_EMAIL = "isolde.bramblewood@example.com";

const QUILL = "Quill Farrowmere";
const QUILL_EMAIL = "quill.farrowmere@example.com";
const QUILL_COMPANY = "Aster & Vane";

test("adding a contact whose email is already in the directory is rejected with a pointer to the existing record", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  // A different *name* on a known *address*: rejection is keyed on email
  // (identity, D-051), so the typed name must not matter.
  await page.getByRole("button", { name: "Add contact" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Padma Rannveig");
  await dialog.getByLabel("Email").fill(PRIYA_EMAIL);
  await dialog.getByRole("button", { name: "Add contact" }).click();

  // Rejected outright (spec.md: duplicates are checked before creation), and
  // the failure points at the record that already holds the address — both
  // by name in the message and as a link straight to the existing profile.
  await expect(
    dialog.getByText(`${PRIYA_EMAIL} (Priya Raman) is already in the directory`),
  ).toBeVisible();
  const openExisting = dialog.getByRole("link", { name: "Open the existing contact" });
  await expect(openExisting).toBeVisible();
  await expect(openExisting).toHaveAttribute("href", /\/admin\/directory\/.+/);
  await page.keyboard.press("Escape");

  // Nothing was written: the address still resolves to exactly one row
  // (search covers name and email), and the attempted name never appears.
  await page.getByLabel("Search contacts").fill("priya.raman");
  await expect(page).toHaveURL(/q=priya\.raman/);
  await expect(page.getByRole("link", { name: "Priya Raman" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Padma Rannveig" })).toHaveCount(0);
});

test("a same-name different-email contact is created with a possible-duplicate note", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  // First Wren — a brand-new contact, so the collision below is entirely
  // this test's own state and no seed name gets a second spelling.
  await page.getByRole("button", { name: "Add contact" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(WREN);
  await dialog.getByLabel("Email").fill(WREN_EMAIL);
  await dialog.getByLabel("Company (optional)").fill("Calloway Audio");
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText(`${WREN} was added to the directory`)).toBeVisible();

  // Second Wren under a different address: two people can share a name
  // (D-059), so this *succeeds* — but the flash note names the possible
  // duplicate while it is still cheap to act on.
  await page.getByRole("button", { name: "Add contact" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(WREN);
  await dialog.getByLabel("Email").fill(WREN_SECOND_EMAIL);
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(
    page.getByText(`another contact named ${WREN} already exists (${WREN_EMAIL})`),
  ).toBeVisible();

  // Both records exist as separate rows (merge is out of scope, D-065), and
  // the table's own duplicate flag marks the pair.
  await page.getByLabel("Search contacts").fill("Wren");
  await expect(page).toHaveURL(/q=Wren/);
  await expect(page.getByRole("link", { name: WREN })).toHaveCount(2);
  await expect(page.getByText("Possible duplicate")).toHaveCount(2);
});

test("CSV import skips rows already in the directory and lands the new ones", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(DIRECTORY);

  // One new row and one duplicate — the duplicate under a mangled name, so
  // the skip is provably keyed on the address, and the result row reports
  // the *existing* record's name, not the file's.
  const csv = [
    "name,email,title,company,bio",
    `${ISOLDE},${ISOLDE_EMAIL},Program Curator,Bramble & Field,`,
    `H. Kim (from spreadsheet),${HANNAH_EMAIL},,,`,
  ].join("\n");

  // The import dialog takes pasted CSV in a textarea (a file input sits
  // beside it feeding the same textarea) — paste is the primary path.
  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Paste CSV").fill(csv);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  // The per-row report: the known address is skipped as a duplicate rather
  // than merged, under the directory's own name for that person; the new
  // row is created.
  await expect(dialog.getByText("1 created · 0 merged · 1 skipped")).toBeVisible();
  await expect(dialog.getByText("Already in the directory — skipped as a duplicate")).toBeVisible();
  await expect(dialog.getByText("Hannah Kim")).toBeVisible();
  // Scoped to the result list — the pasted CSV in the textarea also contains
  // the address, so a bare getByText resolves to two elements.
  await expect(dialog.getByRole("listitem").filter({ hasText: ISOLDE_EMAIL })).toContainText(
    "Created",
  );
  await page.keyboard.press("Escape");

  // The new row landed in the directory; the duplicate changed nothing.
  await page.getByLabel("Search contacts").fill("Isolde");
  await expect(page).toHaveURL(/q=Isolde/);
  await expect(page.getByRole("link", { name: ISOLDE })).toBeVisible();

  await page.getByLabel("Search contacts").fill("hannah.kim");
  await expect(page).toHaveURL(/q=hannah\.kim/);
  await expect(page.getByRole("link", { name: "Hannah Kim" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /from spreadsheet/ })).toHaveCount(0);
});

test("add to event from a pipeline card connects the contact and updates the roster", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");

  // Nothing in the seed enrolls a pipeline card, so build one: a fresh
  // contact (no event connections, so the card's Events section starts
  // empty), enrolled through the same dialog the pipeline test above uses.
  await page.goto(DIRECTORY);
  await page.getByRole("button", { name: "Add contact" }).click();
  const addDialog = page.getByRole("dialog");
  await addDialog.getByLabel("Name").fill(QUILL);
  await addDialog.getByLabel("Email").fill(QUILL_EMAIL);
  await addDialog.getByLabel("Company (optional)").fill(QUILL_COMPANY);
  await addDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText(`${QUILL} was added to the directory`)).toBeVisible();

  await page.goto("/admin/pipeline");
  await page.getByRole("button", { name: "Add prospect" }).click();
  const enrollDialog = page.getByRole("dialog");
  await enrollDialog
    .getByLabel("Contact", { exact: true })
    .selectOption({ label: `${QUILL} (${QUILL_EMAIL})` });
  await enrollDialog.getByRole("button", { name: "Add prospect" }).click();
  await expect(page.getByText(`${QUILL} added to Identified`)).toBeVisible();

  // Open the card. Its Events section is the new part of this page — empty
  // until the picker below fires.
  await page
    .getByRole("region", { name: "Identified stage" })
    .getByRole("link", { name: QUILL })
    .click();
  await expect(page.getByRole("heading", { name: QUILL })).toBeVisible();
  await expect(page.getByText("Not on any event yet — use Add to event.")).toBeVisible();

  // The same AddToEventDialog as the profile, reached from the card (spec.md:
  // "from a profile or pipeline card").
  await page.getByRole("button", { name: "Add to event" }).click();
  const eventDialog = page.getByRole("dialog");
  await eventDialog.getByRole("combobox", { name: "Event", exact: true }).click();
  await page.getByRole("option", { name: /AI Engineer Summit 2026/ }).click();
  await eventDialog.getByRole("button", { name: "Add to event" }).click();
  await expect(page.getByText(`${QUILL} was added to AI Engineer Summit 2026`)).toBeVisible();

  // The card's Events section now lists the connection...
  await expect(page.getByRole("link", { name: "AI Engineer Summit 2026" })).toBeVisible();
  await expect(page.getByText("Not on any event yet — use Add to event.")).toHaveCount(0);

  // ...and the event's speaker roster shows the person, profile intact with
  // no re-entry, because roster and card read the same record (D-051).
  await page.goto("/admin/ai-engineer-summit-2026/speakers");
  await page.getByLabel("Search speakers").fill("Quill");
  await expect(page).toHaveURL(/q=Quill/);
  await expect(page.getByRole("link", { name: QUILL })).toBeVisible();
  await expect(page.getByText(QUILL_COMPANY)).toBeVisible();
});
