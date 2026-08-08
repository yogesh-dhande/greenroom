import { eq } from "drizzle-orm";
import { userSchema, type NewUser } from "@/db/entities";
import { users } from "@/db/schema";
import type { UsersRepo } from "@/db/repos/users";
import type { DrizzleD1 } from "./client";

export function createUsersRepo(db: DrizzleD1): UsersRepo {
  return {
    async getById(id) {
      const row = await db.query.users.findFirst({ where: eq(users.id, id) });
      return row ? userSchema.parse(row) : null;
    },
    async getByEmail(email) {
      const row = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      return row ? userSchema.parse(row) : null;
    },
    async listByRole(role) {
      const rows = await db.query.users.findMany({ where: eq(users.role, role) });
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
