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
import { formatAirtableSummary, runAirtableSync } from "./src/domain/airtable-sync";
import { runReminderJob } from "./src/domain/comms";
import { getEmailSender } from "./src/lib/email";

export default {
  fetch: handler.fetch,

  // Cron trigger from wrangler.jsonc ("*/15 * * * *"). Wiring the D1/SendGrid
  // bindings to the storage-agnostic Repos + EmailSender interfaces here
  // (rather than inside src/domain/comms.ts) keeps the domain layer free of
  // datastore imports, per spec.md's abstraction requirement.
  async scheduled(_event, env, ctx) {
    const repos = createD1Repos(env.DB);
    const sender = getEmailSender(env);
    const appUrl = env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000";

    // The schedule itself lives in runReminderJob (decisions.md D-039: one
    // digest per speaker listing everything still open, sent in the tick that
    // covers Monday 07:00 UTC and stopping once the checklist is clear or the
    // event has started), so this handler stays a wiring shim — the admin
    // "Send task digest now" button calls the identical function, passing
    // `manual: true` to bypass the weekly window.
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

    // One-way Airtable projection (decisions.md D-036, docs/airtable-sync.md).
    // A second, independent job on the same tick: it reads the same repos but
    // shares no state with the reminders, and its own catch means an Airtable
    // outage can never take deadline reminders down with it.
    //
    // The credentials are passed raw — `runAirtableSync` decides whether it is
    // configured and reports an unconfigured run as a skip, so a base that was
    // never set up costs one log line rather than a failing cron.
    ctx.waitUntil(
      runAirtableSync({
        repos,
        airtable: { apiKey: env.AIRTABLE_API_KEY, baseId: env.AIRTABLE_BASE_ID },
        appUrl,
      })
        .then((summary) => {
          console.log(formatAirtableSummary(summary));
        })
        .catch((error: unknown) => {
          console.error("airtable sync failed:", error);
        }),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
