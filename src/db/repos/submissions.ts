import type {
  NewSubmission,
  SpeakerRole,
  Submission,
  SubmissionSpeaker,
  SubmissionStatus,
  SubmissionTrack,
} from "@/db/entities";

export interface SubmissionsRepo {
  getById(id: string): Promise<Submission | null>;
  listByEvent(eventId: string): Promise<Submission[]>;
  listByForm(formId: string): Promise<Submission[]>;
  listByStatus(eventId: string, status: SubmissionStatus): Promise<Submission[]>;
  /** A reviewer's queue: everything tagged with any of their tracks
   * (spec.md §4 — track-based routing, no routing engine). */
  listByTracks(trackIds: string[]): Promise<Submission[]>;
  /** A speaker's own submissions, whether they are primary or co-speaker. */
  listBySpeaker(userId: string): Promise<Submission[]>;
  create(input: NewSubmission): Promise<Submission>;
  update(id: string, patch: Partial<NewSubmission>): Promise<Submission>;
  delete(id: string): Promise<void>;

  // --- tracks (many-to-many) ---
  listTrackIds(submissionId: string): Promise<string[]>;
  /** Batch variant so a list view resolves every submission's tracks in one
   * round trip instead of N. */
  listTracksBySubmissionIds(submissionIds: string[]): Promise<SubmissionTrack[]>;
  /** Replaces the submission's whole track set. */
  setTracks(submissionId: string, trackIds: string[]): Promise<void>;

  // --- speakers (one primary + any number of co-speakers) ---
  listSpeakers(submissionId: string): Promise<SubmissionSpeaker[]>;
  listSpeakersBySubmissionIds(submissionIds: string[]): Promise<SubmissionSpeaker[]>;
  addSpeaker(submissionId: string, userId: string, role: SpeakerRole): Promise<void>;
  removeSpeaker(submissionId: string, userId: string): Promise<void>;
}
