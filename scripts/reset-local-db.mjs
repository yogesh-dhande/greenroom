// Deletes the local D1 (Miniflare) state so `npm run seed` always starts
// from an empty database. Nothing is deployed yet and the local database is
// throwaway demo data, so a reset is cheaper than idempotent seeding.
import { rm } from "node:fs/promises";

const LOCAL_D1_STATE = ".wrangler/state/v3/d1";

await rm(LOCAL_D1_STATE, { recursive: true, force: true });
console.log(`Removed ${LOCAL_D1_STATE}`);
