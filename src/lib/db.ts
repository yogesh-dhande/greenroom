import { cache } from "react";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createD1Repos } from "@/db/repos/d1";
import type { Repos } from "@/db/repos";

/**
 * Entry point route handlers/server actions use to reach the data layer.
 * Returns the storage-agnostic Repos bundle — never leak `env.DB` or a
 * Drizzle client past this function.
 *
 * Memoized per request with React `cache()` like getSessionUser: a render
 * asks for the bundle from several layouts/pages, and each ask rebuilt every
 * repo closure. Outside an RSC render (cron, route handlers) cache() falls
 * through to a plain call, which is also why this must never become a
 * module-level singleton — `env` is per-request on Workers.
 */
export const getRepos = cache(async function getRepos(): Promise<Repos> {
  const { env } = await getCloudflareContext({ async: true });
  return createD1Repos(env.DB);
});

/** Access to the R2 bucket for headshots/slides/documents (spec.md §2). */
export async function getFilesBucket(): Promise<R2Bucket> {
  const { env } = await getCloudflareContext({ async: true });
  return env.FILES;
}
