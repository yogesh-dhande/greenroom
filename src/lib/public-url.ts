import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The origin Greenroom is reachable at from outside, for the surfaces that have
 * to print absolute URLs: `robots.txt`, `sitemap.xml`, `llms.txt`, and the MCP
 * descriptor.
 *
 * Same precedence as src/lib/comms-context.ts, and for the same reason —
 * `APP_URL` wins so production can name the public custom domain even when
 * Better Auth's origin differs, with the `next dev` default last.
 */
export async function publicBaseUrl(): Promise<string> {
  const { env } = await getCloudflareContext({ async: true });
  const raw = env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000";
  // Trailing slashes would double up wherever a caller appends a path.
  return raw.replace(/\/+$/, "");
}
