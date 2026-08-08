import type { NewTaskAssignment, TaskAssignment } from "@/db/entities";

export interface TaskAssignmentsRepo {
  getById(id: string): Promise<TaskAssignment | null>;
  listByTask(taskId: string): Promise<TaskAssignment[]>;
  /** The speaker portal's own to-do list (spec.md §6). */
  listBySpeaker(speakerId: string): Promise<TaskAssignment[]>;
  /** Admin onboarding visibility: everything outstanding for an event
   * (spec.md §8). */
  listByEvent(eventId: string): Promise<TaskAssignment[]>;
  listPendingByEvent(eventId: string): Promise<TaskAssignment[]>;
  /** Pending assignments whose task is due on/before `before` — the
   * reminder cron's query (src/domain/comms.ts, decisions.md D-013). */
  listPendingDueBefore(eventId: string, before: Date): Promise<TaskAssignment[]>;
  getByTaskAndSpeaker(taskId: string, speakerId: string): Promise<TaskAssignment | null>;
  create(input: NewTaskAssignment): Promise<TaskAssignment>;
  update(id: string, patch: Partial<NewTaskAssignment>): Promise<TaskAssignment>;
  delete(id: string): Promise<void>;
}
