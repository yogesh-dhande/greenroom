import { describe, expect, it, vi } from "vitest";
import {
  createOpenNextFetchDispatcher,
  type OpenNextFetchDispatcherDependencies,
} from "@/lib/opennext-fetch-dispatcher";

type TestEnv = { marker: string };
type TestContext = { marker: string };

function setup(overrides: Partial<OpenNextFetchDispatcherDependencies<TestEnv, TestContext>> = {}) {
  const calls: string[] = [];
  const dependencies: OpenNextFetchDispatcherDependencies<TestEnv, TestContext> = {
    async runWithCloudflareRequestContext(_request, _env, _ctx, handle) {
      calls.push("context:start");
      const response = await handle();
      calls.push("context:finish");
      return response;
    },
    maybeGetSkewProtectionResponse: vi.fn(() => {
      calls.push("skew");
      return undefined;
    }),
    handleCdnCgiImageRequest: vi.fn(async () => {
      calls.push("cdn-image");
      return new Response("cdn-image");
    }),
    handleImageRequest: vi.fn(async () => {
      calls.push("next-image");
      return new Response("next-image");
    }),
    middlewareHandler: vi.fn(async (request) => {
      calls.push("middleware");
      return request;
    }),
    nextHandler: vi.fn(async () => {
      calls.push("next");
      return new Response("next");
    }),
    nextImagePath: () => "/_next/image",
    ...overrides,
  };

  return {
    calls,
    dependencies,
    dispatch: createOpenNextFetchDispatcher(dependencies),
    env: { marker: "env" },
    ctx: { marker: "ctx" },
  };
}

describe("OpenNext fetch dispatcher", () => {
  it("runs middleware in Cloudflare context and statically calls the Next handler", async () => {
    const { calls, dependencies, dispatch, env, ctx } = setup();
    const request = new Request("https://greenroom.test/admin");

    const response = await dispatch(request, env, ctx);

    expect(await response.text()).toBe("next");
    expect(calls).toEqual(["context:start", "skew", "middleware", "next", "context:finish"]);
    expect(dependencies.nextHandler).toHaveBeenCalledWith(request, env, ctx, request.signal);
  });

  it("returns skew protection responses before image, middleware, or Next handling", async () => {
    const skewResponse = new Response("skew", { status: 307 });
    const { calls, dependencies, dispatch, env, ctx } = setup({
      maybeGetSkewProtectionResponse: vi.fn(() => {
        calls.push("skew");
        return skewResponse;
      }),
    });

    const response = await dispatch(new Request("https://greenroom.test/admin"), env, ctx);

    expect(response).toBe(skewResponse);
    expect(calls).toEqual(["context:start", "skew", "context:finish"]);
    expect(dependencies.middlewareHandler).not.toHaveBeenCalled();
    expect(dependencies.nextHandler).not.toHaveBeenCalled();
  });

  it.each([
    ["Cloudflare development image", "/cdn-cgi/image/width=320/avatar.png", "cdn-image"],
    ["Next image loader", "/_next/image", "next-image"],
  ])("routes %s before middleware", async (_label, pathname, expectedBody) => {
    const { calls, dependencies, dispatch, env, ctx } = setup();

    const response = await dispatch(
      new Request(`https://greenroom.test${pathname}?url=%2Favatar.png`),
      env,
      ctx,
    );

    expect(await response.text()).toBe(expectedBody);
    expect(calls).toEqual(["context:start", "skew", expectedBody, "context:finish"]);
    expect(dependencies.middlewareHandler).not.toHaveBeenCalled();
    expect(dependencies.nextHandler).not.toHaveBeenCalled();
  });

  it("returns a middleware response without entering the Next server", async () => {
    const middlewareResponse = new Response("redirect", {
      status: 302,
      headers: { location: "/login" },
    });
    const { calls, dependencies, dispatch, env, ctx } = setup({
      middlewareHandler: vi.fn(async () => {
        calls.push("middleware");
        return middlewareResponse;
      }),
    });

    const response = await dispatch(new Request("https://greenroom.test/admin"), env, ctx);

    expect(response).toBe(middlewareResponse);
    expect(calls).toEqual(["context:start", "skew", "middleware", "context:finish"]);
    expect(dependencies.nextHandler).not.toHaveBeenCalled();
  });
});
