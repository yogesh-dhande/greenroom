import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CommsContext } from "@/domain/comms";
import { getRepos } from "@/lib/db";
import { getEmailSender } from "@/lib/email";

/**
 * Assembles the `CommsContext` that src/domain/comms.ts sends through
 * (spec.md §7 — real delivery, no stubs). Route handlers and server actions
 * call this and hand the result to `sendSubmissionConfirmation` and friends.
 *
 * The transport is the **raw** sender: comms wraps it in the `email_log`
 * decorator itself, and passing an already-wrapped one would double-log.
 */
export async function getCommsContext(overrides: Partial<CommsContext> = {}): Promise<CommsContext> {
  const { env } = await getCloudflareContext({ async: true });
  return {
    repos: await getRepos(),
    sender: getEmailSender(env),
    // APP_URL wins so production email can point at the public domain even
    // when better-auth's origin differs; the dev default matches `next dev`.
    appUrl: env.APP_URL ?? env.BETTER_AUTH_URL ?? "http://localhost:3000",
    ...overrides,
  };
}
