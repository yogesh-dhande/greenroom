import type { EventSpeaker, SpeakerConfirmation } from "@/db/entities";

/**
 * A speaker's per-event record (decisions.md D-051): organizer-only notes,
 * plus the membership row that puts a manually added or imported speaker on
 * the event's roster before they have a session or a task.
 *
 * There is no `delete`: the roster derives from three sources, so removing a
 * row here wouldn't remove a speaker who also has a session, and it would
 * silently discard the organizer's notes (same reasoning as D-044(1)).
 */
export interface EventSpeakersRepo {
  get(eventId: string, userId: string): Promise<EventSpeaker | null>;
  listByEvent(eventId: string): Promise<EventSpeaker[]>;
  /** Every event one person is on the roster of — what the speaker portal
   * needs to find the events a hand-added or imported speaker belongs to
   * before they have a submission, a session or a task. */
  listByUser(userId: string): Promise<EventSpeaker[]>;
  /** Idempotent: re-adding an existing speaker leaves their notes alone. */
  add(eventId: string, userId: string): Promise<EventSpeaker>;
  /** Creates the record if it doesn't exist yet — an organizer can write
   * notes about a speaker who arrived via acceptance. */
  setNotes(eventId: string, userId: string, notes: string | null): Promise<EventSpeaker>;
  /**
   * The organizer's explicit confirmation answer (decisions.md D-068); null
   * clears it back to automatic, which is the state every row starts in.
   * Creates the record if it doesn't exist yet, for the same reason
   * `setNotes` does — a speaker who arrived through acceptance has no
   * `event_speakers` row until an organizer writes something about them.
   */
  setConfirmation(
    eventId: string,
    userId: string,
    confirmation: SpeakerConfirmation | null,
  ): Promise<EventSpeaker>;
}
