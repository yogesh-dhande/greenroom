import type { NewTask, Task } from "@/db/entities";

export interface TasksRepo {
  getById(id: string): Promise<Task | null>;
  listByEvent(eventId: string): Promise<Task[]>;
  create(input: NewTask): Promise<Task>;
  update(id: string, patch: Partial<NewTask>): Promise<Task>;
  delete(id: string): Promise<void>;
}
