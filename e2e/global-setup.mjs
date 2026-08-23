/**
 * Warms the dev server's routes before the suite starts.
 *
 * The e2e suite runs against `next dev`, which compiles each route the first
 * time it is requested. That compile can take many seconds, and it lands
 * *inside* whichever assertion happens to touch the route first — so the
 * failure surfaces as a button stuck on "Sending…" or "Saving…" in an
 * arbitrary spec, with nothing wrong in the product. It moved between specs
 * from run to run, passed on isolated re-runs, and reappeared whenever
 * `.next` was cleared, which is exactly the signature of a cold cache rather
 * than a flaky product.
 *
 * Paying the compile here means the first test meets a warm server. The
 * webServer block already waits on `/login`; these are the rest of the routes
 * the specs reach for early.
 */
const ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/admin",
  "/portal",
  "/p/ai-engineer-summit-2026",
  "/p/ai-engineer-summit-2026/schedule",
  "/p/ai-engineer-summit-2026/speakers",
];

export default async function globalSetup() {
  const port = process.env.E2E_PORT ?? 3010;
  const base = `http://localhost:${port}`;
  const started = Date.now();

  await Promise.all(
    ROUTES.map(async (route) => {
      try {
        // Redirects to /login are expected for the authenticated routes — the
        // point is that the route compiled, not what it answered.
        await fetch(`${base}${route}`, { redirect: "manual" });
      } catch {
        // A route that cannot be reached is not worth failing the run over;
        // the test that needs it will report it far more precisely.
      }
    }),
  );

  console.log(`[e2e] warmed ${ROUTES.length} routes in ${Date.now() - started}ms`);
}
