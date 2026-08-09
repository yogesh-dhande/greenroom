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
    const appUrl = env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000";

    // The cadence itself lives in runReminderJob (questions.md Q4: at most one
    // nudge per task every three days, stopping once the task is done or the
    // event has started), so this handler stays a wiring shim — the admin
    // "Send reminders now" button calls the identical function.
    //
    // The run is summarised to the log because a cron firing every 15 minutes
    // is otherwise invisible: `wrangler tail` should show why a quiet run was
    // quiet, not just that it happened.
    ctx.waitUntil(
      runReminderJob({ repos, sender, appUrl })
        .then((result) => {
          console.log(
            `reminders: ${result.remindersSent} sent, ${result.remindersFailed} failed, ` +
              `${result.skipped} skipped (${Object.entries(result.skippedByReason)
                .filter(([, count]) => count > 0)
                .map(([reason, count]) => `${reason}: ${count}`)
                .join(", ") || "none"})`,
          );
        })
        .catch((error: unknown) => {
          console.error("reminder job failed:", error);
        }),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
