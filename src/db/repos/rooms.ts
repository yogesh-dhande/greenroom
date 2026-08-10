import type { NewRoom, Room } from "@/db/entities";

export interface RoomsRepo {
  getById(id: string): Promise<Room | null>;
  listByEvent(eventId: string): Promise<Room[]>;
  /**
   * Every room across several events in one read — for pages that render a
   * speaker's sessions from more than one event and need somewhere to look up
   * each room name. Unordered; each room carries its own `eventId`, so callers
   * group or index it themselves.
   */
  listByEvents(eventIds: string[]): Promise<Room[]>;
  create(input: NewRoom): Promise<Room>;
  update(id: string, patch: Partial<NewRoom>): Promise<Room>;
  delete(id: string): Promise<void>;
}
