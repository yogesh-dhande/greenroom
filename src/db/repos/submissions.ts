import type { NewSubmission, Submission, SubmissionStatus } from "@/db/entities";

export interface SubmissionsRepo {
  getById(id: string): Promise<Submission | null>;
  listByEvent(eventId: string): Promise<Submission[]>;
  listByForm(formId: string): Promise<Submission[]>;
  listBySubmitter(submitterId: string): Promise<Submission[]>;
  /** Used by the evaluation dashboard and onboarding transition (spec §4). */
  listByStatus(eventId: string, status: SubmissionStatus): Promise<Submission[]>;
  /** Used for reviewer assignment by category/track (spec §4). */
  listByCategory(eventId: string, category: string): Promise<Submission[]>;
  create(input: NewSubmission): Promise<Submission>;
  update(id: string, patch: Partial<NewSubmission>): Promise<Submission>;
  delete(id: string): Promise<void>;
}
