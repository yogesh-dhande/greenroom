import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Next.js 16 otherwise appends an "agent rules" block to AGENTS.md on
  // every `next dev`/`next build` — this repo's AGENTS.md is hand-authored
  // project memory (see AGENTS.md itself), so keep Next.js from touching it.
  agentRules: false,
};

// Enables access to Cloudflare bindings (D1, R2, etc.) from `next dev`.
initOpenNextCloudflareForDev();

export default nextConfig;
