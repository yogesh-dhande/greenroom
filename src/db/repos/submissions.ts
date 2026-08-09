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
  /**
   * Resolves the secret in an emailed "finish your draft" link (decisions.md
   * D-034). Possession of the token is the authorisation, so this is a lookup
   * by secret rather than by id — see src/app/submit/[formSlug]/resume.
   */
  getByResumeToken(token: string): Promise<Submission | null>;
  listByEvent(eventId: string): Promise<Submission[]>;
  listByForm(formId: string): Promise<Submission[]>;
  /**
   * One person's proposals on one form, as the *primary* speaker — what a
   * per-form submission cap counts (D-034, D-038). Being someone else's
   * co-speaker doesn't use up a slot, so co-speaker links are excluded here;
   * which statuses count is the domain's call (src/domain/forms.ts).
   */
  listByFormAndSpeaker(formId: string, userId: string): Promise<Submission[]>;
  /**
   * Every submission in `status` across all events — the reminder cron's
   * starting point for "drafts on a form that closes soon" (D-034, D-038). The
   * per-event variant is `listByStatus`.
   */
  listAllByStatus(status: SubmissionStatus): Promise<Submission[]>;
  /** Response counts keyed by form id — the forms list shows one per row and
   * must not fetch every submission to get them. Forms with no submissions
   * are present with a count of 0. */
  countByForms(formIds: string[]): Promise<Record<string, number>>;
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
