import type { Form, NewForm } from "@/db/entities";

export interface FormsRepo {
  getById(id: string): Promise<Form | null>;
  /** Slugs are globally unique — they are the public /submit/{slug} URL. */
  getBySlug(slug: string): Promise<Form | null>;
  /**
   * The named forms in one read. Unordered — callers index the result by id.
   * Ids with no row are absent rather than null.
   */
  listByIds(ids: string[]): Promise<Form[]>;
  listByEvent(eventId: string): Promise<Form[]>;
  listPublishedByEvent(eventId: string): Promise<Form[]>;
  create(input: NewForm): Promise<Form>;
  update(id: string, patch: Partial<NewForm>): Promise<Form>;
  delete(id: string): Promise<void>;
}
