import { defineConfig } from "@playwright/test";
import { E2E_PORT } from "./playwright.config";

/**
 * Records the demo walkthrough (walkthrough/walkthrough.md) as video — not a test run.
 * Reuses the e2e harness (seeded local D1, port 3010, .dev.vars swap +
 * teardown restore), so everything in playwright.config.ts's warning applies:
 * destructive to local dev data, never run alongside a dev server.
 *
 *   npx playwright test --config playwright.demo.config.ts
 *
 * Each act in e2e/demo-walkthrough.record.ts produces one clip under
 * demo-recording/; scripts/assemble-walkthrough.mjs concatenates them into
 * walkthrough/walkthrough.mp4 with the script's narration as subtitles.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "demo-walkthrough.record.ts",
  globalTeardown: "./e2e/global-teardown.mjs",
  workers: 1,
  // Acts are paced for a human viewer, so they run far past test timeouts.
  timeout: 300_000,
  outputDir: "demo-recording",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    // Human-watchable pacing; explicit pauses in the record script handle
    // the beats where a viewer needs time to read.
    launchOptions: { slowMo: 300 },
  },
  webServer: {
    command: `node e2e/start-server.mjs ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
