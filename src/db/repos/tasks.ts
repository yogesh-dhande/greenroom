import type { NewTask, Task } from "@/db/entities";

export interface TasksRepo {
  getById(id: string): Promise<Task | null>;
  /** Batch lookup for resolving the tasks behind a set of assignments
   * (e.g. a speaker's task assignments across events) in one round trip. */
  listByIds(ids: string[]): Promise<Task[]>;
  listByEvent(eventId: string): Promise<Task[]>;
  /** The tasks handed to every speaker of a newly accepted submission
   * (spec.md §5 — acceptance creates the onboarding tasks). */
  listAutoAssignByEvent(eventId: string): Promise<Task[]>;
  create(input: NewTask): Promise<Task>;
  update(id: string, patch: Partial<NewTask>): Promise<Task>;
  delete(id: string): Promise<void>;
}
