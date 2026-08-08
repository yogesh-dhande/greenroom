import type { NewSession, NewSessionSpeaker, Session } from "@/db/entities";

export interface SessionsRepo {
  getById(id: string): Promise<Session | null>;
  /** Used by the agenda builder's list/day/week/track/room views (spec §5)
   * and by src/domain/scheduling.ts for conflict detection. */
  listByEvent(eventId: string): Promise<Session[]>;
  listByRoom(roomId: string): Promise<Session[]>;
  listByTrack(trackId: string): Promise<Session[]>;
  /** All sessions a given speaker is assigned to, across the event — used
   * to detect double-booking (src/domain/scheduling.ts). */
  listBySpeaker(userId: string): Promise<Session[]>;
  create(input: NewSession): Promise<Session>;
  update(id: string, patch: Partial<NewSession>): Promise<Session>;
  delete(id: string): Promise<void>;

  listSpeakers(sessionId: string): Promise<string[]>;
  assignSpeaker(input: NewSessionSpeaker): Promise<void>;
  unassignSpeaker(sessionId: string, userId: string): Promise<void>;
}
