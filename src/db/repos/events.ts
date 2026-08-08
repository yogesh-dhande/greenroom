import type { Event, NewEvent } from "@/db/entities";

/**
 * Storage-agnostic repository interface. Implementations (e.g.
 * src/db/repos/d1/events.ts) may use any datastore, but callers only ever
 * see the plain types from src/db/entities.ts.
 */
export interface EventsRepo {
  getById(id: string): Promise<Event | null>;
  getBySlug(slug: string): Promise<Event | null>;
  listAll(): Promise<Event[]>;
  create(input: NewEvent): Promise<Event>;
  update(id: string, patch: Partial<NewEvent>): Promise<Event>;
  delete(id: string): Promise<void>;
}
