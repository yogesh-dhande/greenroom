import type { EmailLog, NewEmailLog } from "@/db/entities";

export interface EmailLogRepo {
  /** Communication log per speaker (spec §3). */
  listByUser(userId: string): Promise<EmailLog[]>;
  listByEvent(eventId: string): Promise<EmailLog[]>;
  create(input: NewEmailLog): Promise<EmailLog>;
}
