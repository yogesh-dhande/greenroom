import { defineConfig } from "drizzle-kit";

// Generates SQL migrations from src/db/schema.ts into migrations/. Apply
// them with `npm run db:migrate:local` (wrangler d1 migrations apply
// --local) or the remote equivalent — drizzle-kit here is only used for
// `generate`, not `push` or `migrate` (D1 migrations are applied via
// wrangler, per decisions.md D-002).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
