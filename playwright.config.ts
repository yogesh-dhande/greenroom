import { defineConfig } from "@playwright/test";

/**
 * E2E tests for key product flows (spec.md acceptance path). The webServer
 * wrapper (e2e/start-server.mjs) resets + seeds the LOCAL D1 database, points
 * BETTER_AUTH_URL at the e2e port, and restores .dev.vars afterwards — so a
 * run is destructive to local dev data by design, like `npm run seed`.
 *
 * Port 3010 avoids both the usual dev server (3000/3002) and anything else
 * long-running on this machine.
 */
export const E2E_PORT = 3010;

export default defineConfig({
  testDir: "e2e",
  // One worker: tests share a single seeded D1 database and magic-link log.
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node e2e/start-server.mjs ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
