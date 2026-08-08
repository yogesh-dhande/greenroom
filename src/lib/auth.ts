import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/db/schema";
import { createDb } from "@/db/repos/d1/client";
import { getEmailSender } from "@/lib/email";

/**
 * better-auth config (decisions.md D-007, D-016): magic links for every
 * role (organizer, reviewer, speaker), no passwords anywhere. The `users`
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

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    user: {
      modelName: "users",
      additionalFields: {
        role: { type: "string", required: true, defaultValue: "speaker" },
        title: { type: "string", required: false },
        company: { type: "string", required: false },
        bio: { type: "string", required: false },
        headshotUrl: { type: "string", required: false },
      },
    },
    session: { modelName: "authSessions" },
    account: { modelName: "authAccounts" },
    verification: { modelName: "authVerifications" },
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
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
