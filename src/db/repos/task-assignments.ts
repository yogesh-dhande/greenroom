import type { NewTaskAssignment, TaskAssignment } from "@/db/entities";

export interface TaskAssignmentsRepo {
  getById(id: string): Promise<TaskAssignment | null>;
  listByTask(taskId: string): Promise<TaskAssignment[]>;
  /** Speaker portal's own task list (spec §2). */
  listByUser(userId: string): Promise<TaskAssignment[]>;
  /** Organizer onboarding dashboard: who has outstanding tasks, and the
   * reminder job's input query (spec §3, §6). */
  listIncompleteByEvent(eventId: string): Promise<TaskAssignment[]>;
  /** Incomplete assignments with a due date on/before `before` — the
   * reminder cron's query (src/domain/comms.ts). */
  listIncompleteDueBefore(eventId: string, before: Date): Promise<TaskAssignment[]>;
  create(input: NewTaskAssignment): Promise<TaskAssignment>;
  update(id: string, patch: Partial<NewTaskAssignment>): Promise<TaskAssignment>;
  delete(id: string): Promise<void>;
}
