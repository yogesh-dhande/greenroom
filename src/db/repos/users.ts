import type { NewUser, Role, User } from "@/db/entities";

export interface UsersRepo {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  listByRole(role: Role): Promise<User[]>;
  create(input: NewUser): Promise<User>;
  update(id: string, patch: Partial<NewUser>): Promise<User>;
  delete(id: string): Promise<void>;
}
