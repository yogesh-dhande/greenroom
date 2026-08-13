import type { BetterAuthPlugin, User } from "better-auth";
import { createAuthEndpoint, formCsrfMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  authorizeEvaluationAccess,
  type EvaluationAccessEnv,
  type EvaluationAccessGrant,
} from "@/lib/evaluation-access";

const GENERIC_DENIAL = "Evaluation login unavailable";

const evaluationLoginBodySchema = z.object({
  // Validate inside the authorization helper so malformed or unknown values
  // receive the same generic denial as every other authentication failure.
  persona: z.unknown().optional(),
  token: z.unknown().optional(),
});

type EvaluationUser = User & {
  role?: unknown;
  emailVerified: boolean;
};

export function isExpectedEvaluationUser(
  user: EvaluationUser | null,
  grant: EvaluationAccessGrant,
): user is EvaluationUser {
  return Boolean(
    user &&
      user.emailVerified &&
      user.email.trim().toLowerCase() === grant.email &&
      user.role === grant.expectedRole,
  );
}

/**
 * Temporary, env-gated login for the three pre-existing evaluation personas.
 * It never creates a user or changes a role. Better Auth owns both the session
 * write and the signed cookie, so no datastore-specific operation leaks out of
 * its configured adapter.
 */
export function evaluationLoginPlugin(env: EvaluationAccessEnv): BetterAuthPlugin {
  return {
    id: "greenroom-evaluation-login",
    endpoints: {
      evaluationLogin: createAuthEndpoint(
        "/evaluation-login",
        {
          method: "POST",
          requireHeaders: true,
          use: [formCsrfMiddleware],
          body: evaluationLoginBodySchema,
        },
        async (ctx) => {
          const grant = await authorizeEvaluationAccess(env, ctx.body);
          if (!grant) {
            throw ctx.error("UNAUTHORIZED", {
              code: "EVALUATION_LOGIN_DENIED",
              message: GENERIC_DENIAL,
            });
          }

          const found = await ctx.context.internalAdapter.findUserByEmail(grant.email);
          const user = (found?.user ?? null) as EvaluationUser | null;
          if (!isExpectedEvaluationUser(user, grant)) {
            throw ctx.error("UNAUTHORIZED", {
              code: "EVALUATION_LOGIN_DENIED",
              message: GENERIC_DENIAL,
            });
          }

          // `dontRememberMe` produces a browser-session cookie. The session
          // hook, adapter, token generation, expiry, and cookie flags remain
          // Better Auth's rather than being reimplemented here.
          const session = await ctx.context.internalAdapter.createSession(user.id, true);
          await setSessionCookie(ctx, { session, user }, true);

          return ctx.json({ url: "/dashboard" });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path) => path.startsWith("/evaluation-login"),
        window: 60,
        // Several judges can legitimately open three role contexts from one
        // shared office IP. Entropy and expiry protect the bearer capability;
        // this bound is only abuse backpressure, not the primary control.
        max: 20,
      },
    ],
  };
}
