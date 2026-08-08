import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// See decisions.md D-010: public pages (CFP, embeds, schedule) use Next.js
// caching/ISR with tag-based revalidation. The R2 incremental cache backs
// that with the same R2 bucket used for file storage.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
