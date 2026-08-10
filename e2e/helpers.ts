import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const MAGIC_LINK_LOG = ".dev-magic-links.log";

/** Lines already in the log for `email`, so we only accept a fresh link. */
async function linkCount(email: string): Promise<number> {
  try {
    const log = await readFile(MAGIC_LINK_LOG, "utf8");
    return log.split("\n").filter((line) => line.split("\t")[1] === email).length;
  } catch {
    return 0;
  }
}

/**
 * Signs in via the real magic-link flow: request a link on /login, read it
 * from the dev transport's log file (tab-separated: timestamp, email, url),
 * and follow it. Seeded accounts: admin@greenroom.dev (admin),
 * dana@greenroom.dev (reviewer), priya.raman@example.com (speaker).
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const alreadyLogged = await linkCount(email);

  // Switching personas mid-test: /login redirects an authenticated user
  // straight into their app (src/app/login/page.tsx), so drop the session
  // cookie first or the Email field below never exists.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByText("Check", { exact: false })).toBeVisible();

  // The link is appended by the dev server; poll briefly for the new line.
  let url: string | undefined;
  await expect(async () => {
    const log = await readFile(MAGIC_LINK_LOG, "utf8");
    const lines = log.split("\n").filter((line) => line.split("\t")[1] === email);
    expect(lines.length).toBeGreaterThan(alreadyLogged);
    url = lines[lines.length - 1].split("\t")[2];
  }).toPass({ timeout: 15_000 });

  await page.goto(url!);
  // Magic-link verification redirects into the app (never back to /login).
  await expect(page).not.toHaveURL(/\/login/);
}
