import type { NewTrack, Track } from "@/db/entities";

export interface TracksRepo {
  getById(id: string): Promise<Track | null>;
  listByEvent(eventId: string): Promise<Track[]>;
  create(input: NewTrack): Promise<Track>;
  update(id: string, patch: Partial<NewTrack>): Promise<Track>;
  delete(id: string): Promise<void>;
}
