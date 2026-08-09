import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Next.js 16 otherwise appends an "agent rules" block to AGENTS.md on
  // every `next dev`/`next build` — this repo's AGENTS.md is hand-authored
  // project memory (see AGENTS.md itself), so keep Next.js from touching it.
  agentRules: false,
  experimental: {
    // Headshots and slide decks are uploaded to R2 through a server action
    // (src/app/submit/[formSlug]/actions.ts). Next's default server-action
    // body limit is 1 MB, which a print-quality headshot blows through — this
    // sits just above MAX_UPLOAD_BYTES in src/lib/uploads.ts, which is where
    // the real limit is enforced and explained to the submitter.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

// Enables access to Cloudflare bindings (D1, R2, etc.) from `next dev`.
initOpenNextCloudflareForDev();

export default nextConfig;
