/**
 * Restores .dev.vars after an e2e run. The start-server.mjs exit handlers
 * are unreliable (Playwright SIGKILLs the webServer process tree, so they
 * never fire), which used to leave BETTER_AUTH_URL pointing at the e2e
 * port — breaking magic links for the next `npm run dev`. This teardown
 * runs in Playwright's own process, which shuts down normally.
 */
import { copyFileSync, existsSync, unlinkSync } from "node:fs";

export default function globalTeardown() {
  const BACKUP = ".dev.vars.e2e-backup";
  if (existsSync(BACKUP)) {
    copyFileSync(BACKUP, ".dev.vars");
    unlinkSync(BACKUP);
  }
}
