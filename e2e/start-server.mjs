/**
 * Playwright webServer wrapper: seeds the local D1 database, points
 * BETTER_AUTH_URL at the e2e port (better-auth builds magic-link URLs from it
 * and rejects POSTs from other origins), starts `next dev`, and restores
 * .dev.vars when the server is torn down.
 */
import { execSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import process from "node:process";

const port = process.argv[2] ?? "3010";
const DEV_VARS = ".dev.vars";
const BACKUP = ".dev.vars.e2e-backup";

if (!existsSync(DEV_VARS)) {
  console.error(`e2e: ${DEV_VARS} not found — copy .env.example first`);
  process.exit(1);
}

// A leftover backup means a previous run died before restoring — the backup
// is the pristine file, so recover from it instead of re-backing-up the
// already-swapped .dev.vars (which would bake the e2e port in permanently).
if (existsSync(BACKUP)) {
  copyFileSync(BACKUP, DEV_VARS);
}

// Swap the auth origin, keeping a backup to restore on exit.
copyFileSync(DEV_VARS, BACKUP);
const swapped = readFileSync(DEV_VARS, "utf8").replace(
  /^BETTER_AUTH_URL=.*$/m,
  `BETTER_AUTH_URL=http://localhost:${port}`,
);
writeFileSync(DEV_VARS, swapped);

function restore() {
  if (existsSync(BACKUP)) {
    copyFileSync(BACKUP, DEV_VARS);
    unlinkSync(BACKUP);
  }
}

let server;
function shutdown(code) {
  restore();
  if (server && server.exitCode === null) server.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("uncaughtException", (err) => {
  console.error(err);
  shutdown(1);
});

try {
  // Deterministic starting state, same as `npm run seed`.
  execSync("npm run seed", { stdio: "inherit" });

  server = spawn("npx", ["next", "dev", "--port", port], { stdio: "inherit" });
  server.on("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
