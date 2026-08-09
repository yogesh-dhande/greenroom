import { asc, eq, inArray } from "drizzle-orm";
import { userSchema, type NewUser } from "@/db/entities";
import { users } from "@/db/schema";
import type { UsersRepo } from "@/db/repos/users";
import type { DrizzleD1 } from "./client";

/**
 * The Drizzle column keys are the entity keys (see src/db/schema.ts), so a
 * row round-trips through `userSchema` without a field map — including the
 * speaker-editable profile columns (`title`, `company`, `bio`, `headshotUrl`,
 * `websiteUrl`, `linkedinUrl`, `twitterUrl`) that `update()` receives as a
 * `Partial<NewUser>` patch from app code. Nothing Drizzle-shaped escapes this
 * file: every return value is parsed back into the entity type first.
 */
export function createUsersRepo(db: DrizzleD1): UsersRepo {
  return {
    async getById(id) {
      const row = await db.query.users.findFirst({ where: eq(users.id, id) });
      return row ? userSchema.parse(row) : null;
    },
    async getByEmail(email) {
      const row = await db.query.users.findFirst({ where: eq(users.email, email) });
      return row ? userSchema.parse(row) : null;
    },
    async listByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await db.query.users.findMany({ where: inArray(users.id, ids) });
      return rows.map((r) => userSchema.parse(r));
    },
    async listByRole(role) {
      const rows = await db.query.users.findMany({
        where: eq(users.role, role),
        orderBy: [asc(users.name)],
      });
      return rows.map((r) => userSchema.parse(r));
    },
    async listAll() {
      const rows = await db.query.users.findMany({ orderBy: [asc(users.name)] });
      return rows.map((r) => userSchema.parse(r));
    },
    async create(input: NewUser) {
      const [row] = await db.insert(users).values(input).returning();
      return userSchema.parse(row);
    },
    async update(id, patch) {
      const [row] = await db
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return userSchema.parse(row);
    },
    async delete(id) {
      await db.delete(users).where(eq(users.id, id));
    },
  };
}
