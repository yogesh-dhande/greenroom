/**
 * The request-routing contract emitted by @opennextjs/cloudflare's Worker
 * template, with every generated dependency injected by the custom entry.
 *
 * Keeping this small seam authored and unit-tested lets custom-worker.ts bind
 * the generated Next handler statically instead of importing the generated
 * dispatcher, whose per-request dynamic import can cross request contexts.
 */
export interface OpenNextFetchDispatcherDependencies<Env, Context> {
  runWithCloudflareRequestContext(
    request: Request,
    env: Env,
    ctx: Context,
    handle: () => Promise<Response>,
  ): Promise<Response>;
  maybeGetSkewProtectionResponse(request: Request): Response | Promise<Response> | undefined;
  handleCdnCgiImageRequest(url: URL, env: Env): Promise<Response>;
  handleImageRequest(url: URL, headers: Headers, env: Env): Promise<Response>;
  middlewareHandler(request: Request, env: Env, ctx: Context): Promise<Request | Response>;
  nextHandler(
    request: Request,
    env: Env,
    ctx: Context,
    signal: AbortSignal,
  ): Promise<Response>;
  nextImagePath(): string;
}

export function createOpenNextFetchDispatcher<Env, Context>(
  dependencies: OpenNextFetchDispatcherDependencies<Env, Context>,
): (request: Request, env: Env, ctx: Context) => Promise<Response> {
  return async (request, env, ctx) =>
    dependencies.runWithCloudflareRequestContext(request, env, ctx, async () => {
      const skewResponse = dependencies.maybeGetSkewProtectionResponse(request);
      if (skewResponse) return skewResponse;

      const url = new URL(request.url);

      // Development-only image proxy. Production /cdn-cgi/image requests are
      // intercepted by Cloudflare before they reach the Worker.
      if (url.pathname.startsWith("/cdn-cgi/image/")) {
        return dependencies.handleCdnCgiImageRequest(url, env);
      }

      // Fallback for Next's default image loader.
      if (url.pathname === dependencies.nextImagePath()) {
        return dependencies.handleImageRequest(url, request.headers, env);
      }

      const requestOrResponse = await dependencies.middlewareHandler(request, env, ctx);
      if (requestOrResponse instanceof Response) return requestOrResponse;

      return dependencies.nextHandler(requestOrResponse, env, ctx, request.signal);
    });
}
