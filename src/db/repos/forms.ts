import type { Form, FormStatus, NewForm } from "@/db/entities";

export interface FormsRepo {
  getById(id: string): Promise<Form | null>;
  getBySlug(eventId: string, slug: string): Promise<Form | null>;
  listByEvent(eventId: string): Promise<Form[]>;
  listByStatus(eventId: string, status: FormStatus): Promise<Form[]>;
  create(input: NewForm): Promise<Form>;
  update(id: string, patch: Partial<NewForm>): Promise<Form>;
  delete(id: string): Promise<void>;
}
