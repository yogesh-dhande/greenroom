import type { EmailLog, EmailRelatedType, NewEmailLog } from "@/db/entities";

export interface EmailLogRepo {
  /** Communication log per speaker (spec.md §7), keyed by email address so
   * it survives a speaker never claiming their account. */
  listByRecipient(email: string): Promise<EmailLog[]>;
  listByRelated(relatedType: EmailRelatedType, relatedId: string): Promise<EmailLog[]>;
  /** Newest first — backs the admin Communications view. */
  listRecent(limit: number): Promise<EmailLog[]>;
  create(input: NewEmailLog): Promise<EmailLog>;
}
