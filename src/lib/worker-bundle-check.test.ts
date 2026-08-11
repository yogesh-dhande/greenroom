import { describe, expect, it } from "vitest";
import { inspectWorkerBundleSourceMap } from "@/lib/worker-bundle-check";

const safeSources = [
  "../../custom-worker.ts",
  "../../src/lib/opennext-fetch-dispatcher.ts",
  "../../.open-next/cloudflare/init.js",
  "../../.open-next/cloudflare/images.js",
  "../../.open-next/cloudflare/skew-protection.js",
  "../../.open-next/middleware/handler.mjs",
  "../../.open-next/server-functions/default/handler.mjs",
];

describe("Worker dry-run bundle inspection", () => {
  it("accepts the local static dispatcher and generated handler pieces", () => {
    expect(
      inspectWorkerBundleSourceMap({
        sources: safeSources,
        sourcesContent: safeSources.map(() => "export const staticallyBundled = true;"),
      }).errors,
    ).toEqual([]);
  });

  it("rejects the generated dispatcher and its request-time handler import", () => {
    const inspection = inspectWorkerBundleSourceMap({
      sources: [...safeSources, "../../.open-next/worker.js"],
      sourcesContent: [
        ...safeSources.map(() => "export const staticallyBundled = true;"),
        'const { handler } = await import("./server-functions/default/handler.mjs");',
      ],
    });

    expect(inspection.errors).toEqual([
      "the generated .open-next/worker.js dispatcher is still bundled",
      "a source in the final bundle still dynamically imports the default Next handler per request",
    ]);
  });

  it("fails closed when a required generated routing layer is absent", () => {
    const inspection = inspectWorkerBundleSourceMap({
      sources: safeSources.filter(
        (source) => !source.endsWith("/.open-next/middleware/handler.mjs"),
      ),
      sourcesContent: [],
    });

    expect(inspection.errors).toContain(
      "expected final bundle source is missing: /.open-next/middleware/handler.mjs",
    );
  });
});
