import type { EmailTemplate, EmailTrigger, NewEmailTemplate } from "@/db/entities";

export interface EmailTemplatesRepo {
  getById(id: string): Promise<EmailTemplate | null>;
  listByEvent(eventId: string): Promise<EmailTemplate[]>;
  listByTrigger(eventId: string, trigger: EmailTrigger): Promise<EmailTemplate[]>;
  create(input: NewEmailTemplate): Promise<EmailTemplate>;
  update(id: string, patch: Partial<NewEmailTemplate>): Promise<EmailTemplate>;
  delete(id: string): Promise<void>;
}
