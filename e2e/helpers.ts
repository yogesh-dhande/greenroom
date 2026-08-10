import { expect, type Page } from "@playwright/test";
import { readdir, readFile, stat } from "node:fs/promises";

const MAGIC_LINK_LOG = ".dev-magic-links.log";

/** Lines in the dev magic-link log for `email` — how sign-in helpers (and
 * tests asserting a link really went out) tell a fresh link from an old one. */
export async function magicLinkCount(email: string): Promise<number> {
  try {
    const log = await readFile(MAGIC_LINK_LOG, "utf8");
    return log.split("\n").filter((line) => line.split("\t")[1] === email).length;
  } catch {
    return 0;
  }
}

/** Messages the development transport wrote after `since`. */
export async function devEmailsSince(
  since: number,
  extension = ".txt",
): Promise<string[]> {
  const files = await readdir(".dev-emails").catch(() => [] as string[]);
  const bodies = await Promise.all(
    files
      .filter((name) => name.endsWith(extension))
      .map(async (name) => {
        const path = `.dev-emails/${name}`;
        const info = await stat(path);
        return info.mtimeMs >= since ? readFile(path, "utf8") : "";
      }),
  );
  return bodies.filter(Boolean);
}

/**
 * Signs in via the real magic-link flow: request a link on /login, read it
 * from the dev transport's log file (tab-separated: timestamp, email, url),
 * and follow it. Seeded accounts: admin@greenroom.dev (admin),
 * dana@greenroom.dev (reviewer), priya.raman@example.com (speaker).
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const alreadyLogged = await magicLinkCount(email);

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
