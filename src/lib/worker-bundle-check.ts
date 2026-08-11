export interface WorkerBundleSourceMap {
  sources?: unknown;
  sourcesContent?: unknown;
}

export interface WorkerBundleInspection {
  sources: string[];
  errors: string[];
}

const REQUIRED_SOURCES = [
  "/custom-worker.ts",
  "/src/lib/opennext-fetch-dispatcher.ts",
  "/.open-next/cloudflare/init.js",
  "/.open-next/cloudflare/images.js",
  "/.open-next/cloudflare/skew-protection.js",
  "/.open-next/middleware/handler.mjs",
  "/.open-next/server-functions/default/handler.mjs",
];

const REQUEST_TIME_HANDLER_IMPORT =
  /await\s+import\(\s*["']\.\/server-functions\/default\/handler\.mjs["']\s*\)/;

function normalizedSource(source: string): string {
  return source.replaceAll("\\", "/");
}

export function inspectWorkerBundleSourceMap(
  sourceMap: WorkerBundleSourceMap,
): WorkerBundleInspection {
  const sources = Array.isArray(sourceMap.sources)
    ? sourceMap.sources
        .filter((source): source is string => typeof source === "string")
        .map(normalizedSource)
    : [];
  const sourcesContent = Array.isArray(sourceMap.sourcesContent)
    ? sourceMap.sourcesContent.filter((source): source is string => typeof source === "string")
    : [];
  const errors: string[] = [];

  if (sources.some((source) => source.endsWith("/.open-next/worker.js"))) {
    errors.push("the generated .open-next/worker.js dispatcher is still bundled");
  }
  if (sourcesContent.some((source) => REQUEST_TIME_HANDLER_IMPORT.test(source))) {
    errors.push("a source in the final bundle still dynamically imports the default Next handler per request");
  }
  for (const required of REQUIRED_SOURCES) {
    if (!sources.some((source) => source.endsWith(required))) {
      errors.push(`expected final bundle source is missing: ${required}`);
    }
  }

  return { sources, errors };
}
