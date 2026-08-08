/**
 * Development-only magic-link capture.
 *
 * Magic links are the only way into Greenroom (decisions.md D-007), so local
 * development needs somewhere to read them from when no Resend key is
 * configured. Every requested link is printed to the server console *and*
 * appended to `.dev-magic-links.log` (gitignored) so you can grab the newest
 * one with `tail -n 1 .dev-magic-links.log` — or curl it directly.
 *
 * This module is only ever reached via a dynamic import guarded by
 * `NODE_ENV !== "production"` (see src/lib/auth.ts), so the `node:fs`
 * dependency never has to resolve in the deployed Worker.
 */
export const DEV_MAGIC_LINK_LOG = ".dev-magic-links.log";

export async function recordDevMagicLink(email: string, url: string): Promise<void> {
  console.log(
    `\n>> MAGIC LINK for ${email}\n   ${url}\n   (also appended to ${DEV_MAGIC_LINK_LOG})\n`,
  );
  try {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      DEV_MAGIC_LINK_LOG,
      `${new Date().toISOString()}\t${email}\t${url}\n`,
      "utf8",
    );
  } catch (error) {
    // A read-only or non-Node runtime is fine — the console line above is
    // still there, so never let logging break a sign-in.
    console.warn(`Could not append to ${DEV_MAGIC_LINK_LOG}:`, error);
  }
}
