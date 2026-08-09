import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AirtableSyncContext } from "@/domain/airtable-sync";
import { getRepos } from "@/lib/db";

/**
 * Assembles the `AirtableSyncContext` for the one-way sync
 * (docs/airtable-sync.md, decisions.md D-036) — the Next.js-side twin of the
 * wiring custom-worker.ts's `scheduled` handler does for the cron. Same shape
 * as `getCommsContext`: read the environment here so the domain layer stays
 * free of Cloudflare imports.
 *
 * `AIRTABLE_API_KEY` is a Worker secret and `AIRTABLE_BASE_ID` a plain var in
 * wrangler.jsonc; local dev reads both from `.dev.vars`. Both are handed over
 * unvalidated on purpose — `runAirtableSync` decides whether it is configured
 * and names the missing variable in its skip reason.
 */
export async function getAirtableSyncContext(
  overrides: Partial<AirtableSyncContext> = {},
): Promise<AirtableSyncContext> {
  const { env } = await getCloudflareContext({ async: true });
  return {
    repos: await getRepos(),
    airtable: { apiKey: env.AIRTABLE_API_KEY, baseId: env.AIRTABLE_BASE_ID },
    ...overrides,
  };
}
