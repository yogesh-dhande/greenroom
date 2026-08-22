import { cache } from "react";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { magicLink } from "better-auth/plugins/magic-link";
import { jwt } from "better-auth/plugins";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/db/schema";
import { createDb } from "@/db/repos/d1/client";
import { createD1Repos } from "@/db/repos/d1";
import { decideAdminBootstrap, parseAdminEmails } from "@/domain/team";
import { createLoggingEmailSender, getEmailSender } from "@/lib/email";
import { evaluationLoginPlugin } from "@/lib/evaluation-login-plugin";

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
 *
 * Building this is not cheap — a Drizzle client, the full repo bundle, and a
 * betterAuth instance with its plugins — and a single /admin render used to
 * pay for it once per session check. `cache()` is React's *per-request* memo
 * (the same tool src/app/p/[eventSlug]/data.ts uses), so the work now happens
 * once per request while each request still reads its own bindings. A
 * module-level singleton would be the wrong fix: on Workers it would pin one
 * request's `env` and leak it into every later request the isolate serves.
 * Outside a React request scope (route handlers, the cron `scheduled`
 * handler) `cache` simply calls through uncached, which is correct here too.
 */
export const getAuth = cache(async function getAuth() {
  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  // Reads/writes this file does on its own behalf still go through the
  // storage-agnostic repo layer; the raw Drizzle client above exists only
  // because better-auth's adapter demands one.
  const repos = createD1Repos(env.DB);
  // Sign-in links are part of a speaker's communication history (spec.md §7),
  // so they go through the same email_log-writing wrapper as everything else.
  const sender = createLoggingEmailSender(getEmailSender(env), repos.emailLog);
  const isDev = process.env.NODE_ENV !== "production";
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  const baseURL = env.BETTER_AUTH_URL ?? "http://localhost:3000";

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    // Explicit rather than inferred: the magic-link callback URL is built
    // from this, and a wrong host produces links that silently fail.
    baseURL,
    // The same value Better Auth falls back to at runtime (`options.basePath ||
    // "/api/auth"`), stated so that `auth.options.basePath` is actually *set*.
    // Consumers that read it directly do not all apply that fallback: the
    // OAuth resource client builds its JWKS URL as
    // `baseURL + (options.basePath ?? "") + "/jwks"`, so leaving this undefined
    // pointed token verification at `<origin>/jwks`, which 404s. Every OAuth
    // access token then failed with "Jwks failed: Not Found" — invisible to API
    // keys, which take an entirely different verification path.
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    user: {
      modelName: "users",
      additionalFields: {
        // New signups are speakers (they arrive through a public CFP form);
        // admins and reviewers are promoted deliberately.
        role: {
          type: "string",
          required: false,
          defaultValue: "speaker",
          input: false,
        },
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
    databaseHooks: {
      session: {
        create: {
          /**
           * First-admin bootstrap (decisions.md D-043).
           *
           * `ADMIN_EMAILS` (comma-separated, case-insensitive) is the only
           * automatic route to admin: every address on it is promoted as it
           * signs in. There is no "first account wins" fallback — an instance
           * deployed without the variable is promoted by hand instead
           * (docs/deploying.md §7). Decision logic itself is the pure
           * `decideAdminBootstrap` in src/domain/team.ts.
           *
           * Hooked here — just before the session row is written — rather than
           * on user creation, so it also catches an account that already
           * existed as a speaker before the operator set the variable, and so
           * the new role is already committed when /dashboard reads it to
           * route the person home.
           *
           * Never throws: a bootstrap that can't run is a missing promotion,
           * not a failed sign-in, and locking everyone out is the worse of the
           * two failures.
           */
          async before(session) {
            // Nothing to promote to when the operator named nobody.
            if (adminEmails.length === 0) return;
            try {
              const user = await repos.users.getById(session.userId);
              if (!user) return;
              const decision = decideAdminBootstrap({
                email: user.email,
                role: user.role,
                adminEmails,
              });
              if (decision.promote)
                await repos.users.update(user.id, { role: "admin" });
            } catch (error) {
              console.error("admin bootstrap check failed", error);
            }
          },
        },
      },
    },
    plugins: [
      evaluationLoginPlugin(env),
      apiKey({
        // External keys are visibly Greenroom credentials and are never
        // accepted as browser sessions. Scope/event authorization is still
        // re-checked by the API application layer on every request.
        defaultPrefix: "gr_",
        requireName: true,
        enableMetadata: true,
        schema: { apikey: { modelName: "apiCredentials" } },
        rateLimit: { enabled: false },
        keyExpiration: {
          defaultExpiresIn: 90 * 24 * 60 * 60,
          minExpiresIn: 30 * 24 * 60 * 60,
          maxExpiresIn: 365 * 24 * 60 * 60,
        },
        customAPIKeyGetter(ctx) {
          const direct = ctx.headers?.get("x-api-key")?.trim();
          if (direct?.startsWith("gr_")) return direct;
          const authorization = ctx.headers?.get("authorization")?.trim();
          const bearer = authorization?.match(/^Bearer\s+(gr_[^\s]+)$/i);
          return bearer?.[1] ?? null;
        },
      }),
      jwt({
        disableSettingJwtHeader: true,
        schema: { jwks: { modelName: "authJwks" } },
        // Stated so issuance and verification agree on one string.
        //
        // Tokens are minted with `iss = jwt.issuer ?? ctx.context.baseURL`, and
        // that context baseURL *includes* the base path — so tokens carried
        // `<origin>/api/auth`. The OAuth resource client verifying them defaults
        // instead to `auth.options.baseURL`, which does not, so it demanded
        // `iss = <origin>` and rejected every token as "invalid access token".
        // The authorization-server metadata already advertises the longer form,
        // so that is the correct one to pin; this changes no issued value, it
        // only stops the two sides from disagreeing.
        jwt: { issuer: `${baseURL}/api/auth` },
      }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        scopes: ["greenroom:read", "greenroom:write", "offline_access"],
        validAudiences: [`${baseURL}/api/v1`, `${baseURL}/mcp`],
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        allowDynamicClientRegistration: true,
        // MCP clients are public clients and use authorization-code + S256
        // PKCE, so they cannot carry a registration secret.
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: ["greenroom:read"],
        clientRegistrationAllowedScopes: [
          "greenroom:write",
          "offline_access",
        ],
        async clientPrivileges({ user }) {
          if (!user?.id) return false;
          const owner = await repos.users.getById(user.id);
          return owner?.role === "admin";
        },
      }),
      magicLink({
        // Pinned rather than left to better-auth's default: the email copy
        // below hard-codes "5 minutes", so a library upgrade changing the
        // default must not silently make that copy wrong.
        expiresIn: 300,
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
            text: `Click the link below to sign in to Greenroom:\n\n${url}\n\nThis link expires in 5 minutes. If you didn't ask for it, you can ignore this email.`,
            html: `<p>Click below to sign in to Greenroom:</p><p><a href="${url}">${url}</a></p><p>This link expires in 5 minutes.</p>`,
            log: { kind: "magic_link" },
          });
        },
      }),
    ],
  });
});
