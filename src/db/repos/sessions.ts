import type { NewSession, Session, SessionSpeaker } from "@/db/entities";

export interface SessionsRepo {
  getById(id: string): Promise<Session | null>;
  /** Backs the agenda builder and public program (spec.md §9). */
  listByEvent(eventId: string): Promise<Session[]>;
  listByDay(eventId: string, day: string): Promise<Session[]>;
  /** The agenda builder's parking lot: accepted talks with no day/time yet. */
  listUnscheduled(eventId: string): Promise<Session[]>;
  listByRoom(roomId: string): Promise<Session[]>;
  listByTrack(trackId: string): Promise<Session[]>;
  /** Every session a speaker is on — the input to double-booking detection
   * (src/domain/scheduling.ts). */
  listBySpeaker(userId: string): Promise<Session[]>;
  /** The session an accepted submission was converted into, if any. */
  getBySubmission(submissionId: string): Promise<Session | null>;
  create(input: NewSession): Promise<Session>;
  update(id: string, patch: Partial<NewSession>): Promise<Session>;
  delete(id: string): Promise<void>;

  listSpeakerIds(sessionId: string): Promise<string[]>;
  listSpeakersBySessionIds(sessionIds: string[]): Promise<SessionSpeaker[]>;
  assignSpeaker(sessionId: string, userId: string): Promise<void>;
  unassignSpeaker(sessionId: string, userId: string): Promise<void>;
}
