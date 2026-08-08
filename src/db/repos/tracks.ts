import type { NewTrack, Track } from "@/db/entities";

export interface TracksRepo {
  getById(id: string): Promise<Track | null>;
  listByEvent(eventId: string): Promise<Track[]>;
  listByIds(ids: string[]): Promise<Track[]>;
  create(input: NewTrack): Promise<Track>;
  update(id: string, patch: Partial<NewTrack>): Promise<Track>;
  delete(id: string): Promise<void>;

  // Reviewer routing (spec.md §4): reviewers own tracks, submissions pick
  // tracks. This pairing is the whole routing mechanism.
  /** The tracks this reviewer is responsible for. */
  listByReviewer(userId: string): Promise<Track[]>;
  /** The reviewers responsible for a track. */
  listReviewerIds(trackId: string): Promise<string[]>;
  assignReviewer(userId: string, trackId: string): Promise<void>;
  unassignReviewer(userId: string, trackId: string): Promise<void>;
  /** Replaces a reviewer's whole track assignment set in one call. */
  setReviewerTracks(userId: string, trackIds: string[]): Promise<void>;
}
