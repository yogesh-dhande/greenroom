import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Key flow: team management (spec.md §1, decisions.md D-043/D-044) — who has
 * admin or reviewer access, reviewer track routing, and adding someone by
 * email so their first magic link lands with the intended role.
 *
 * Tests run in file order on one worker and build on each other's state; this
 * file runs last alphabetically, so it can safely reshape the team.
 */

const EVENT_SLUG = "ai-engineer-summit-2026";
const TEAM = `/admin/${EVENT_SLUG}/team`;

/** Pre-created by the invite test, signs in later with the role adopted. */
const INVITED_EMAIL = "casey.okafor@example.com";

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

test("inviting a new address pre-creates the account with the chosen role", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(TEAM);

  await page.getByLabel("Email").fill(INVITED_EMAIL);
  // Role defaults to Reviewer, which is what we want.
  await page.getByRole("button", { name: "Add to team" }).click();

  await expect(page.getByText(`${INVITED_EMAIL} can now sign in as a reviewer`)).toBeVisible();

  // The roster shows the pending state: no sign-in yet, no tracks assigned.
  const row = page.getByRole("row").filter({ hasText: INVITED_EMAIL });
  await expect(row.getByText("Not signed in yet")).toBeVisible();
  await expect(row.getByText("No tracks — empty queue")).toBeVisible();
});

test("the invited address signs in and lands in the admin area as a reviewer", async ({
  page,
}) => {
  // Fresh browser context: this is the invitee's first ever sign-in. The
  // magic link must adopt the pre-created row — same role — rather than
  // minting a new speaker account (D-044).
  await signIn(page, INVITED_EMAIL);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/admin/);

  // A reviewer, not an admin: no Team page for them.
  await page.goto(TEAM);
  await expect(page).not.toHaveURL(/\/team/);
});

test("a reviewer's tracks are edited from the roster", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(TEAM);

  const row = page.getByRole("row").filter({ hasText: INVITED_EMAIL });
  await row.getByRole("button", { name: "Edit tracks" }).click();

  await page.getByRole("checkbox", { name: "AI Engineering" }).click();
  await page.getByRole("button", { name: /^Save/ }).click();

  await expect(row.getByText("AI Engineering")).toBeVisible();
  await expect(row.getByText("No tracks — empty queue")).toHaveCount(0);
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
