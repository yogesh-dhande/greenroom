import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/**
 * `/robots.txt`. Absent until now, so every crawler — and the 2026-08-18
 * evaluator, which asked for it eleven times across two days — got a 404.
 *
 * The disallow list is a crawling instruction, never an access control: every
 * one of these paths guards itself server-side. It exists so that the public
 * program is what gets indexed, rather than sign-in pages and authenticated
 * shells that would render as empty or redirect.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await publicBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/portal",
          "/dashboard",
          "/api/",
          "/mcp",
          "/oauth/",
          "/login",
          "/evaluation-access",
          // Resume links carry a single-use token in the path; keeping them out
          // of an index is worth more than the page ever would be.
          "/submit/*/resume/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
