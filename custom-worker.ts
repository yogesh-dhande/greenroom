/**
 * Custom Worker entry point.
 *
 * The OpenNext Cloudflare adapter generates a worker that only exports a
 * `fetch` handler. To also handle the cron trigger configured in
 * wrangler.jsonc (deadline reminders, decisions.md D-013), this file wraps
 * the generated handler and adds a `scheduled` export. wrangler.jsonc's
 * `main` points here instead of directly at `.open-next/worker.js`.
 *
 * See: https://opennext.js.org/cloudflare/howtos/custom-worker
 */

// @ts-expect-error `.open-next/worker.js` is generated at build time by
// `opennextjs-cloudflare build` and does not exist until then.
import { default as handler } from "./.open-next/worker.js";
import { createD1Repos } from "./src/db/repos/d1";
import { runReminderJob } from "./src/domain/comms";
import { getEmailSender } from "./src/lib/email";

export default {
  fetch: handler.fetch,

  // Cron trigger from wrangler.jsonc ("*/15 * * * *"). Wiring the D1/Resend
  // bindings to the storage-agnostic Repos + EmailSender interfaces here
  // (rather than inside src/domain/comms.ts) keeps the domain layer free of
  // datastore imports, per spec.md's abstraction requirement.
  async scheduled(_event, env, ctx) {
    const repos = createD1Repos(env.DB);
    const sender = getEmailSender(env);
    ctx.waitUntil(runReminderJob({ repos, sender }).then(() => undefined));
  },
} satisfies ExportedHandler<CloudflareEnv>;
