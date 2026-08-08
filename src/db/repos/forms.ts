import type { Form, NewForm } from "@/db/entities";

export interface FormsRepo {
  getById(id: string): Promise<Form | null>;
  /** Slugs are globally unique — they are the public /submit/{slug} URL. */
  getBySlug(slug: string): Promise<Form | null>;
  listByEvent(eventId: string): Promise<Form[]>;
  listPublishedByEvent(eventId: string): Promise<Form[]>;
  create(input: NewForm): Promise<Form>;
  update(id: string, patch: Partial<NewForm>): Promise<Form>;
  delete(id: string): Promise<void>;
}
