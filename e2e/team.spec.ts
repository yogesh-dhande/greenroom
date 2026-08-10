import { addTrack, expect, test } from "./fixtures";
import { devEmailsSince, magicLinkCount, signIn } from "./helpers";

/**
 * Key flow: team management (spec.md §1, decisions.md D-043/D-044) — who has
 * admin or reviewer access, reviewer track routing, and adding someone by
 * email so their first magic link lands with the intended role.
 *
 * Mutating scenarios create their own event and teammate so no test needs a
 * role, track assignment, or URL produced by an earlier test.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const TEAM = `/admin/${EVENT_SLUG}/team`;

test("a reviewer gets no Team link and is bounced from the page", async ({ page }) => {
  await signIn(page, "dana@greenroom.dev");

  await page.goto(`/admin/${EVENT_SLUG}`);
  const nav = page.getByRole("navigation");
  // Positive control from the reviewer's own workspace (D-047): Communications
  // is admin-only, so it can't play that part.
  await expect(nav.getByRole("link", { name: "Review rounds" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Communications" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);

  // The nav hiding is convenience; the page itself must refuse the URL.
  await page.goto(TEAM);
  await expect(page).not.toHaveURL(/\/team/);
  await expect(page.getByRole("heading", { name: "Team" })).toHaveCount(0);
});

test("the only admin cannot change their own role", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(TEAM);

  // The seed has exactly one admin, so the trap door is removed up front:
  // the select is disabled rather than letting the server bounce it.
  const roleSelect = page.getByLabel("Role for Avery Chen");
  await expect(roleSelect).toBeDisabled();
  await expect(page.getByText("The only admin — promote someone else first.")).toBeVisible();
});

test("a named teammate is invited, routed, handed over, and signs in with that role", async ({
  page,
  fixtureId,
  isolatedEvent,
}) => {
  const email = `${fixtureId}@example.com`;
  const name = `Reviewer ${fixtureId}`;
  const track = `Track ${fixtureId}`;
  const startedAt = Date.now();

  await addTrack(page, isolatedEvent.slug, track);
  await page.goto(`/admin/${isolatedEvent.slug}/team`);
  await page.getByLabel("Name (optional)").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByText(`${email} can now sign in as a reviewer`)).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText(name);
  await expect(row.getByText("Not signed in yet")).toBeVisible();
  await expect(row.getByText("No tracks — empty queue")).toBeVisible();

  await expect(async () => {
    const invite = (await devEmailsSince(startedAt)).find(
      (body) => body.includes(email) && body.includes("X-Greenroom-Log: team_invite"),
    );
    expect(invite).toBeTruthy();
    expect(invite).toContain("Avery Chen invited you");
    expect(invite).toContain(isolatedEvent.name);
    expect(invite).toContain("as a reviewer");
    expect(invite).toContain("/login");
  }).toPass({ timeout: 15_000 });

  await row.getByRole("button", { name: "Edit tracks" }).click();
  await page.getByRole("checkbox", { name: track }).click();
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(row.getByText(track)).toBeVisible();

  await row.getByRole("button", { name: "View link" }).click();
  const handover = page.getByRole("dialog", { name: "Sign-in link" });
  await expect(handover.locator("code")).toContainText(`/login?email=${encodeURIComponent(email)}`);
  await page.keyboard.press("Escape");

  const already = await magicLinkCount(email);
  await row.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText(/Sign-in link emailed to/)).toBeVisible();
  await expect(async () => expect(await magicLinkCount(email)).toBeGreaterThan(already)).toPass({
    timeout: 15_000,
  });

  await page.context().clearCookies();
  await page.goto(`/login?email=${encodeURIComponent(email)}`);
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await signIn(page, email);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/admin/);
  await page.goto(`/admin/${isolatedEvent.slug}/team`);
  await expect(page).not.toHaveURL(/\/team/);
});

test("a second admin frees the first, and removal is demotion with a confirm", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(TEAM);

  // The invite path also promotes existing accounts: Priya already has a
  // speaker account from the seed.
  await page.getByLabel("Email").fill("priya.raman@example.com");
  await page.getByLabel("Role", { exact: true }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByText(/already had an account — they're now an admin/)).toBeVisible();

  // With two admins, the original admin's select is live again.
  await expect(page.getByLabel("Role for Avery Chen")).toBeEnabled();

  // Removing Priya is a demotion behind a confirm — never a deletion.
  await page.getByLabel("Role for Priya Raman").click();
  await page.getByRole("option", { name: "Remove from team" }).click();
  await expect(
    page.getByRole("alertdialog").filter({ hasText: "Remove Priya Raman from the team?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove access" }).click();

  await expect(page.getByText("Priya Raman was removed from the team")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "priya.raman@example.com" })).toHaveCount(0);

  // Back to one admin: the guard hint returns.
  await expect(page.getByLabel("Role for Avery Chen")).toBeDisabled();
});
