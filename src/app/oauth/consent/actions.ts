"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";

async function finishConsent(accept: boolean, formData: FormData): Promise<never> {
  await requireAdmin("/oauth/consent");
  const scope = String(formData.get("scope") ?? "").trim();
  const oauthQuery = String(formData.get("oauthQuery") ?? "").trim();
  const allowed = new Set(["greenroom:read", "greenroom:write", "offline_access"]);
  const requested = scope.split(/\s+/).filter(Boolean);
  if (requested.some((value) => !allowed.has(value))) {
    redirect("/admin?oauthError=invalid_scope");
  }

  const auth = await getAuth();
  const result = await auth.api.oauth2Consent({
    headers: await headers(),
    body: {
      accept,
      ...(scope ? { scope } : {}),
      ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
    },
  });
  redirect(result.url);
}

export async function approveOAuthConsent(formData: FormData): Promise<never> {
  return finishConsent(true, formData);
}

export async function denyOAuthConsent(formData: FormData): Promise<never> {
  return finishConsent(false, formData);
}
