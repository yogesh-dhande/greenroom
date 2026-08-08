"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/** Client-side better-auth instance for use in Client Components (e.g. the
 * /login form). Talks to src/app/api/auth/[...all]/route.ts. */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
