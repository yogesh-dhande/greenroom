import type { NewRoom, Room } from "@/db/entities";

export interface RoomsRepo {
  getById(id: string): Promise<Room | null>;
  listByEvent(eventId: string): Promise<Room[]>;
  create(input: NewRoom): Promise<Room>;
  update(id: string, patch: Partial<NewRoom>): Promise<Room>;
  delete(id: string): Promise<void>;
}
