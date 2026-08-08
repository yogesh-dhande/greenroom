import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

/** Thin wrapper so callers don't need to know the drizzle-orm/d1 import
 * path. `db` is a fresh client per request (see src/lib/db.ts) — do not
 * cache it across requests, per Cloudflare Workers guidance. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type DrizzleD1 = ReturnType<typeof createDb>;
