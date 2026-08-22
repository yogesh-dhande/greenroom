import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signIn } from "./helpers";

/**
 * The OAuth 2.1 authorization-code flow that MCP clients use, end to end.
 *
 * This path was completely dead in production on 2026-08-18 and nothing caught
 * it, because every existing API/MCP test authenticates with a `gr_` API key
 * created through the admin UI — an entirely separate verification path. Four
 * independent bugs sat on this one, each hiding the next:
 *
 *  1. The consent screen looked the client up with Better Auth's *owner-scoped*
 *     `getOAuthClient`, which throws UNAUTHORIZED for any client whose `userId`
 *     and `referenceId` are both null — that is, every client created through
 *     the unauthenticated dynamic registration we enable for MCP. A blanket
 *     `catch { notFound() }` turned that into a 404.
 *  2. It read `.name` off the RFC 7591 registration shape, whose field is
 *     `client_name`, so the screen always said "this client".
 *  3. Approving consent called `auth.api.oauth2Consent` without a `request` and
 *     with Next's read-only headers, so Better Auth could neither re-enter its
 *     authorize endpoint nor return a redirect URL.
 *  4. `basePath` and the JWT `issuer` were left implicit, so token verification
 *     fetched JWKS from `<origin>/jwks` (404) and then demanded the wrong `iss`.
 *
 * Two clients were registered in production and not one access token was ever
 * issued.
 */

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface RegisteredClient {
  client_id: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

function initializeParams() {
  return {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-mcp-client", version: "1.0.0" },
  };
}

/** Registers a public client the way an MCP client does — no credentials. */
async function registerClient(origin: string, name: string, redirectUri: string) {
  const response = await fetch(`${origin}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "greenroom:read",
    }),
  });
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return (await response.json()) as RegisteredClient;
}

/**
 * Runs authorize -> consent -> token for one resource and returns the token.
 *
 * Every call the client makes is a bare `fetch`, never `page.request`, which
 * would share the browser's cookie jar: Better Auth enforces its CSRF origin
 * check only on requests carrying cookies, and a real MCP client sends neither
 * cookies nor an Origin. Only the consent step is a browser navigation, because
 * only that step is one.
 */
async function authorizeFor(
  page: Page,
  origin: string,
  clientId: string,
  redirectUri: string,
  resource: string,
): Promise<TokenResponse> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const authorizeUrl = new URL("/api/auth/oauth2/authorize", origin);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "greenroom:read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", resource);

  await page.goto(authorizeUrl.toString());

  // A consent already granted for this client is remembered, so on later
  // rounds the screen is skipped and the code comes straight back.
  if (new URL(page.url()).pathname === "/oauth/consent") {
    await page.getByRole("button", { name: "Allow access" }).click();
  }
  await page.waitForURL((url: URL) => url.searchParams.has("code") || url.searchParams.has("error"));

  const landed = new URL(page.url());
  expect(landed.searchParams.get("error")).toBeNull();
  expect(landed.searchParams.get("state")).toBe(state);
  const code = landed.searchParams.get("code");
  expect(code).toEqual(expect.any(String));

  const tokenResponse = await fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      // RFC 8707 wants `resource` at the token endpoint as well as at
      // authorize; it is what binds the `aud` claim the API then checks.
      resource,
    }),
  });
  expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
  const token = (await tokenResponse.json()) as TokenResponse;
  expect(token.access_token).toEqual(expect.any(String));
  return token;
}

/**
 * Reads one JSON-RPC result. The endpoint answers either plain JSON or a
 * single SSE event depending on what the client's `accept` header allows, and
 * a real client accepts both — so this accepts both too.
 */
async function readJsonRpc(
  response: Response,
): Promise<{ result?: { serverInfo?: { name?: string } } }> {
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  if (!data) throw new Error("MCP SSE response contained no data event");
  return JSON.parse(data.slice("data: ".length));
}

async function mcpInitialize(origin: string, accessToken: string): Promise<Response> {
  return fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: initializeParams(),
    }),
  });
}

test("a self-registered client completes consent and reaches both the REST API and MCP", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL!;
  // Redirect back to a path on this origin so the browser can actually land on
  // it and hand us the code; a real MCP client uses a loopback port it is
  // listening on. Deliberately a path that renders a plain 404 and nothing
  // else: `/login` bounces an already-authenticated visitor to `/admin`, which
  // strips the `?code=` before it can be read.
  const redirectUri = `${origin}/e2e-oauth-callback`;
  const client = await registerClient(origin, "e2e-mcp-client", redirectUri);

  await signIn(page, "admin@greenroom.dev");

  // --- The consent screen itself. This was the 404 in production. --------
  const authorizeUrl = new URL("/api/auth/oauth2/authorize", origin);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "greenroom:read");
  authorizeUrl.searchParams.set("code_challenge", base64url(randomBytes(32)));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  const consent = await page.goto(authorizeUrl.toString());

  expect(consent?.status(), "the consent screen must render for an ownerless client").toBe(200);
  expect(new URL(page.url()).pathname).toBe("/oauth/consent");
  // It names the client it is asking about, rather than "this client".
  // (CardTitle renders a div, so this is a text match, not a heading role.)
  await expect(page.getByText("Allow e2e-mcp-client to use Greenroom?")).toBeVisible();
  await expect(
    page.getByText("Read events, sessions, speakers, submissions, and configuration"),
  ).toBeVisible();

  // --- A token for the REST API opens the REST API. ----------------------
  const apiToken = await authorizeFor(
    page,
    origin,
    client.client_id,
    redirectUri,
    `${origin}/api/v1`,
  );
  const events = await fetch(`${origin}/api/v1/events`, {
    headers: { Authorization: `Bearer ${apiToken.access_token}` },
  });
  expect(events.status, await events.clone().text()).toBe(200);
  const body = (await events.json()) as { data: Array<{ id: string }> };
  expect(Array.isArray(body.data)).toBe(true);

  // ...and does NOT open MCP. The token is audience-bound to the resource it
  // was requested for (RFC 8707), so presenting it elsewhere must be refused.
  const wrongAudience = await mcpInitialize(origin, apiToken.access_token);
  expect(wrongAudience.status, "an /api/v1 token must not be accepted at /mcp").toBe(401);

  // --- A token for MCP opens MCP. ---------------------------------------
  const mcpToken = await authorizeFor(page, origin, client.client_id, redirectUri, `${origin}/mcp`);
  const mcp = await mcpInitialize(origin, mcpToken.access_token);
  expect(mcp.status, await mcp.clone().text()).toBe(200);
  const handshake = await readJsonRpc(mcp);
  expect(handshake.result?.serverInfo?.name).toBe("greenroom");
});

test("an unknown client id is still an honest 404 on the consent screen", async ({ page }) => {
  await signIn(page, "admin@greenroom.dev");
  // The fix must not turn every consent failure into a rendered page — a
  // client that genuinely does not exist is the one case that really is a 404.
  const response = await page.goto("/oauth/consent?client_id=definitely-not-a-real-client");
  expect(response?.status()).toBe(404);
});

test("the MCP endpoint answers a GET probe with a readable 405", async ({ page }) => {
  // The evaluator probed GET before POST and got a bare framework 405 with no
  // Allow header, which is indistinguishable from a misrouted URL. 405 is the
  // correct status for a stateless JSON server with no SSE stream to offer;
  // what it owes the client is the reason.
  for (const method of ["get", "delete"] as const) {
    const response = await page.request[method]("/mcp");
    expect(response.status()).toBe(405);
    expect(response.headers()["allow"]).toContain("POST");

    const body = (await response.json()) as {
      jsonrpc: string;
      error: { message: string; data: { allow: string[] } };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.message).toContain("POST");
    expect(body.error.data.allow).toContain("POST");
  }
});
