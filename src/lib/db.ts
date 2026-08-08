import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createD1Repos } from "@/db/repos/d1";
import type { Repos } from "@/db/repos";

/**
 * Entry point route handlers/server actions use to reach the data layer.
 * Returns the storage-agnostic Repos bundle — never leak `env.DB` or a
 * Drizzle client past this function.
 */
export async function getRepos(): Promise<Repos> {
  const { env } = await getCloudflareContext({ async: true });
  return createD1Repos(env.DB);
}

/** Access to the R2 bucket for headshots/slides/documents (spec.md §2). */
export async function getFilesBucket(): Promise<R2Bucket> {
  const { env } = await getCloudflareContext({ async: true });
  return env.FILES;
}
