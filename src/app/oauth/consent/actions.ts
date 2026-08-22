"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/public-url";
import { requireAdmin } from "@/lib/session";

/**
 * The origin this request arrived on, for naming the endpoint being invoked.
 * Falls back to the configured public URL when a proxy strips the host header.
 */
async function baseUrlFromHeaders(requestHeaders: Headers): Promise<string> {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return publicBaseUrl();
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

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
  const requestHeaders = await headers();
  const body = {
    accept,
    ...(scope ? { scope } : {}),
    ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
  };

  // Two things this call needs that a server action does not supply on its own,
  // both of which silently broke the flow rather than failing loudly:
  //
  // 1. A mutable `accept: application/json`. Better Auth ends consent by
  //    re-entering its authorize endpoint, whose `handleRedirect` *returns*
  //    `{ url }` only when `accept` asks for JSON, and otherwise throws an
  //    internal redirect that `auth.api` swallows into `{}`. `consentEndpoint`
  //    tries to set that header itself, but Next's `headers()` is read-only, so
  //    the write is a no-op and we got `{}` back — then `redirect("")`.
  // 2. A `request`. The authorize endpoint opens with
  //    `if (!ctx.request) throw UNAUTHORIZED("request not found")`, and calling
  //    `auth.api.*` with only headers and a body leaves `ctx.request` undefined.
  //
  // A copy of the incoming headers keeps the session cookie — which is what
  // actually authenticates the consent — while letting us set `accept`.
  const forwarded = new Headers(requestHeaders);
  forwarded.set("accept", "application/json");

  const origin = await baseUrlFromHeaders(requestHeaders);
  const result = await auth.api.oauth2Consent({
    headers: forwarded,
    // The URL only has to name the endpoint being invoked; everything that
    // matters travels in the body and the cookies.
    request: new Request(`${origin}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: forwarded,
    }),
    body,
  });

  // Asking for JSON above also changes the *shape* Better Auth hands back: with
  // that accept header better-call serialises the endpoint's return value into
  // a Response instead of returning it directly. Both shapes carry the same
  // `{ redirect, url }` payload, so unwrap whichever arrived rather than
  // depending on which one this version produces.
  const payload = (
    result instanceof Response ? await result.json() : result
  ) as { url?: string } | null;

  if (!payload?.url) {
    // Never redirect to an empty string — that surfaces as `TypeError: Invalid
    // URL` from deep inside the framework, which says nothing about consent.
    console.error("oauth consent: no redirect url returned", payload);
    redirect("/admin?oauthError=consent_failed");
  }
  redirect(payload.url);
}

export async function approveOAuthConsent(formData: FormData): Promise<never> {
  return finishConsent(true, formData);
}

export async function denyOAuthConsent(formData: FormData): Promise<never> {
  return finishConsent(false, formData);
}
