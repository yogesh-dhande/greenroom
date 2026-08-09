/**
 * Turning a filled-in CFP form into records (spec.md §2, §3).
 *
 * A submission is spread across four places — the `submissions` row, its
 * tracks, its speakers, and the `users` rows behind those speakers — and the
 * public submit page and the submitter's own edit page both have to land all
 * four consistently. That shared job lives here rather than in either route.
 *
 * Storage-agnostic in the same way src/domain/comms.ts is: everything arrives
 * through the `Repos` interface bundle, and only entity types from
 * src/db/entities.ts cross the boundary.
 */
import {
  RESERVED_FIELD_IDS,
  type Event,
  type Form,
  type NewSubmission,
  type Submission,
  type SubmissionStatus,
  type Track,
  type User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  cleanCoSpeakers,
  publicFields,
  selectedTrackNames,
  validateSubmissionValues,
  type CoSpeakerValue,
  type FormValues,
} from "@/domain/forms";
import { fileUrl } from "@/lib/uploads";

export interface SubmissionContext {
  repos: Repos;
}

export interface SaveSubmissionInput {
  form: Form;
  event: Event;
  /** The event's tracks — the track question's answers resolve against these. */
  tracks: Track[];
  values: FormValues;
  /** Update this submission instead of creating one. */
  submissionId?: string;
  /** Status for a newly created submission. */
  status?: SubmissionStatus;
}

export type SaveSubmissionResult =
  | { ok: true; submission: Submission; created: boolean; primarySpeaker: User }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function text(values: FormValues, id: string): string {
  const value = values[id];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Finds the person behind an email address, or creates them.
 *
 * New people are speakers with an unverified email: submitting a proposal
 * doesn't prove you own the address, and the magic-link sign-in they use to
 * come back and edit is what verifies it (decisions.md D-007).
 */
async function findOrCreateSpeaker(
  ctx: SubmissionContext,
  person: { email: string; name?: string | null; title?: string | null; company?: string | null },
): Promise<User> {
  const email = person.email.trim().toLowerCase();
  const existing = await ctx.repos.users.getByEmail(email);
  if (existing) {
    // Fill in blanks we've just been told, never overwrite what they curated
    // themselves in the portal.
    const patch: Partial<User> = {};
    if (!existing.name && person.name) patch.name = person.name;
    if (!existing.title && person.title) patch.title = person.title;
    if (!existing.company && person.company) patch.company = person.company;
    return Object.keys(patch).length > 0 ? ctx.repos.users.update(existing.id, patch) : existing;
  }
  return ctx.repos.users.create({
    email,
    emailVerified: false,
    name: person.name?.trim() || null,
    role: "speaker",
    title: person.title?.trim() || null,
    company: person.company?.trim() || null,
    bio: null,
    headshotUrl: null,
    // The speaker fills these in themselves at /portal/profile (spec.md §6).
    websiteUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    socials: null,
    image: null,
  });
}

/** Bio/headshot answers become profile data when the speaker has none yet
 * (spec.md §8 — admins need to see who is still missing a bio or headshot). */
async function enrichPrimaryProfile(
  ctx: SubmissionContext,
  speaker: User,
  values: FormValues,
): Promise<void> {
  const patch: Partial<User> = {};
  const bio = text(values, RESERVED_FIELD_IDS.speakerBio);
  if (bio && !speaker.bio) patch.bio = bio;

  const headshotKey = text(values, RESERVED_FIELD_IDS.headshot);
  if (headshotKey && !speaker.headshotUrl) patch.headshotUrl = fileUrl(headshotKey);

  if (Object.keys(patch).length > 0) await ctx.repos.users.update(speaker.id, patch);
}

/** Track ids for the names the submitter picked; unknown names are ignored
 * (a track renamed since the answer was given simply drops out). */
function resolveTrackIds(tracks: Track[], names: string[]): string[] {
  const byName = new Map(tracks.map((track) => [track.name.toLowerCase(), track.id]));
  return names
    .map((name) => byName.get(name.trim().toLowerCase()))
    .filter((id): id is string => Boolean(id));
}

async function syncSpeakers(
  ctx: SubmissionContext,
  submissionId: string,
  primary: User,
  coSpeakers: CoSpeakerValue[],
): Promise<void> {
  const resolved: User[] = [];
  for (const row of coSpeakers) {
    if (row.email === primary.email) continue; // never demote the submitter
    resolved.push(await findOrCreateSpeaker(ctx, row));
  }

  const keep = new Set([primary.id, ...resolved.map((user) => user.id)]);
  for (const link of await ctx.repos.submissions.listSpeakers(submissionId)) {
    if (!keep.has(link.userId)) await ctx.repos.submissions.removeSpeaker(submissionId, link.userId);
  }

  await ctx.repos.submissions.addSpeaker(submissionId, primary.id, "primary");
  for (const user of resolved) await ctx.repos.submissions.addSpeaker(submissionId, user.id, "co");
}

/**
 * Validates and persists a set of answers, creating the submission or
 * updating an existing one.
 *
 * Validation is the same generated validator the browser ran — a client that
 * skipped it (or a stale tab whose form schema has since changed) gets the
 * identical answer here.
 */
export async function saveSubmission(
  ctx: SubmissionContext,
  input: SaveSubmissionInput,
): Promise<SaveSubmissionResult> {
  const trackNames = input.tracks.map((track) => track.name);
  const fields = publicFields(input.form.fields, trackNames);

  const validation = validateSubmissionValues(fields, input.values);
  if (!validation.ok) {
    return {
      ok: false,
      error: "Some answers need another look.",
      fieldErrors: validation.errors,
    };
  }
  const values = validation.values;

  const email = text(values, RESERVED_FIELD_IDS.speakerEmail);
  if (!email) {
    return {
      ok: false,
      error: "We need an email address to send your confirmation to.",
      fieldErrors: { [RESERVED_FIELD_IDS.speakerEmail]: "Your email is required" },
    };
  }

  const name = text(values, RESERVED_FIELD_IDS.speakerName);
  const primary = await findOrCreateSpeaker(ctx, { email, name });

  const title = text(values, RESERVED_FIELD_IDS.title) || `Proposal from ${name || email}`;
  const description = text(values, RESERVED_FIELD_IDS.description) || null;

  // The co-speaker rows become `submission_speakers`, so they'd be duplicated
  // (and go stale) if they were also kept in `answers`.
  const answers: FormValues = { ...values };
  delete answers[RESERVED_FIELD_IDS.coSpeakers];

  const payload: NewSubmission = {
    eventId: input.event.id,
    formId: input.form.id,
    title,
    description,
    answers,
    status: input.status ?? "submitted",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };

  let submission: Submission;
  let created: boolean;
  if (input.submissionId) {
    // Only the answer-shaped fields are updated: a decision already recorded
    // on this submission is the organizer's, not the submitter's, and an edit
    // must never reset it (spec.md §3).
    submission = await ctx.repos.submissions.update(input.submissionId, {
      title: payload.title,
      description: payload.description,
      answers: payload.answers,
    });
    created = false;
  } else {
    submission = await ctx.repos.submissions.create(payload);
    created = true;
  }

  await ctx.repos.submissions.setTracks(
    submission.id,
    resolveTrackIds(input.tracks, selectedTrackNames(fields, values)),
  );
  await syncSpeakers(ctx, submission.id, primary, cleanCoSpeakers(input.values[RESERVED_FIELD_IDS.coSpeakers]));
  await enrichPrimaryProfile(ctx, primary, values);

  return { ok: true, submission, created, primarySpeaker: primary };
}

// ---------------------------------------------------------------------------
// Reads for the edit view
// ---------------------------------------------------------------------------

export interface SubmissionDetail {
  submission: Submission;
  form: Form;
  event: Event;
  tracks: Track[];
  trackNames: string[];
  primarySpeaker: User;
  coSpeakers: CoSpeakerValue[];
  speakerIds: string[];
}

/** Everything the submitter's edit page needs, in one place. */
export async function loadSubmissionDetail(
  ctx: SubmissionContext,
  submissionId: string,
): Promise<SubmissionDetail | null> {
  const submission = await ctx.repos.submissions.getById(submissionId);
  if (!submission) return null;

  const [form, event, tracks, links, trackIds] = await Promise.all([
    ctx.repos.forms.getById(submission.formId),
    ctx.repos.events.getById(submission.eventId),
    ctx.repos.tracks.listByEvent(submission.eventId),
    ctx.repos.submissions.listSpeakers(submission.id),
    ctx.repos.submissions.listTrackIds(submission.id),
  ]);
  if (!form || !event) return null;

  const users = await ctx.repos.users.listByIds(links.map((link) => link.userId));
  const byId = new Map(users.map((user) => [user.id, user]));
  const primaryLink = links.find((link) => link.role === "primary") ?? links[0];
  const primarySpeaker = primaryLink ? byId.get(primaryLink.userId) : undefined;
  if (!primarySpeaker) return null;

  const selected = new Set(trackIds);
  return {
    submission,
    form,
    event,
    tracks,
    trackNames: tracks.filter((track) => selected.has(track.id)).map((track) => track.name),
    primarySpeaker,
    coSpeakers: links
      .filter((link) => link.userId !== primarySpeaker.id)
      .map((link) => byId.get(link.userId))
      .filter((user): user is User => Boolean(user))
      .map((user) => ({
        name: user.name ?? "",
        email: user.email,
        title: user.title ?? "",
        company: user.company ?? "",
      })),
    speakerIds: links.map((link) => link.userId),
  };
}
