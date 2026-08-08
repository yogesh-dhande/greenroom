import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/db/schema";
import { createDb } from "@/db/repos/d1/client";
import { getEmailSender } from "@/lib/email";

/**
 * better-auth config (decisions.md D-007, D-016): magic links for every
 * role (admin, reviewer, speaker), no passwords anywhere. The `users`
 * table doubles as both the domain "who is this person" entity and
 * better-auth's user model — see src/db/schema.ts for why session/account/
 * verification are prefixed `auth_` (naming collision with the domain
 * `sessions` table of scheduled conference talks).
 *
 * D1 bindings aren't available at module load time in most Next.js runtimes,
 * so the adapter's `db` is created lazily per request via getCloudflareContext.
 */
export async function getAuth() {
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const sender = getEmailSender(env);
  const isDev = process.env.NODE_ENV !== "production";

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    // Explicit rather than inferred: the magic-link callback URL is built
    // from this, and a wrong host produces links that silently fail.
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    user: {
      modelName: "users",
      additionalFields: {
        // New signups are speakers (they arrive through a public CFP form);
        // admins and reviewers are promoted deliberately.
        role: { type: "string", required: false, defaultValue: "speaker", input: false },
        title: { type: "string", required: false, input: false },
        company: { type: "string", required: false, input: false },
        bio: { type: "string", required: false, input: false },
        headshotUrl: { type: "string", required: false, input: false },
      },
    },
    session: { modelName: "authSessions" },
    account: { modelName: "authAccounts" },
    verification: { modelName: "authVerifications" },
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          if (isDev) {
            // Local development has no mail provider: print the link and
            // append it to .dev-magic-links.log so it can be clicked/curled.
            const { recordDevMagicLink } = await import("@/lib/dev-magic-link");
            await recordDevMagicLink(email, url);
          }
          await sender.send({
            to: email,
            subject: "Your Greenroom sign-in link",
            html: `<p>Click below to sign in to Greenroom:</p><p><a href="${url}">${url}</a></p><p>This link expires in 5 minutes.</p>`,
          });
        },
      }),
    ],
  });
}
