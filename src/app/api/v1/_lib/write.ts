import { revalidatePath } from "next/cache";
import type { Event, Session, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  AdminWorkflowError,
  createSession,
  createSpeaker,
  decideSubmission,
  placeSession,
  setSessionSpeakers,
  setSpeakerConfirmation,
  unscheduleSession,
  updateSession,
  updateSpeaker,
  type CreateSessionInput,
  type CreateSpeakerInput,
  type DecideSubmissionInput,
  type PlaceSessionInput,
  type UpdateSessionInput,
  type UpdateSpeakerInput,
} from "@/domain/admin-api";
import {
  toApiSessionDetail,
  toApiSpeakerDetail,
  toApiSubmissionDetail,
} from "@/domain/api-dtos";
import { ApiError } from "@/lib/api-request";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import {
  authenticateExternalRequest,
  requireExternalScope,
} from "@/lib/external-auth";

interface ApiWriteContext {
  actor: User;
  event: Event;
  repos: Repos;
}

/**
 * Authenticates a write credential, applies its event allowlist, and resolves
 * the event before any child resource. A mismatched child is consequently
 * always a 404 and never reveals which other event owns it.
 */
async function apiWriteContext(request: Request, eventId: string): Promise<ApiWriteContext> {
  const auth = await authenticateExternalRequest(request, eventId);
  requireExternalScope(auth, "write", eventId);
  const repos = await getRepos();
  const [event, actor] = await Promise.all([
    repos.events.getById(eventId),
    repos.users.getById(auth.ownerId),
  ]);
  if (!event) throw new ApiError(404, "not_found", "Event not found.");
  // authenticateExternalRequest already checks this. Keep the adapter robust
  // if a credential owner disappears between that check and this read.
  if (!actor || actor.role !== "admin") {
    throw new ApiError(401, "unauthorized", "The credential is no longer active.");
  }
  return { actor, event, repos };
}

async function readApiJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "bad_request", "The request body must be valid JSON.");
  }
}

async function workflow<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AdminWorkflowError)) throw error;
    if (error.code === "validation") {
      throw new ApiError(400, "bad_request", error.message, error.details);
    }
    if (error.code === "not_found") {
      throw new ApiError(404, "not_found", `${error.message.replace(/[.]$/, "")}.`);
    }
    throw new ApiError(500, "internal_error", error.message);
  }
}

function invalidateEvent(eventSlug: string): void {
  revalidatePath(`/admin/${eventSlug}`, "layout");
  revalidatePath(`/p/${eventSlug}`, "layout");
  revalidatePath(`/p/${eventSlug}/feed.json`);
  revalidatePath(`/p/${eventSlug}/feed.xml`);
  revalidatePath(`/p/${eventSlug}/feed.ics`);
  revalidatePath(`/embed/${eventSlug}`, "layout");
}

async function sessionDetail(repos: Repos, eventId: string, session: Session) {
  if (session.eventId !== eventId) {
    throw new ApiError(404, "not_found", "Session not found.");
  }
  const [links, track, room] = await Promise.all([
    repos.sessions.listSpeakersBySessionIds([session.id]),
    session.trackId ? repos.tracks.getById(session.trackId) : Promise.resolve(null),
    session.roomId ? repos.rooms.getById(session.roomId) : Promise.resolve(null),
  ]);
  const speakers = await repos.users.listByIds(links.map((link) => link.userId));
  return toApiSessionDetail(session, { speakers, track, room });
}

async function speakerDetail(repos: Repos, eventId: string, speaker: User) {
  const [member, sessions] = await Promise.all([
    repos.eventSpeakers.get(eventId, speaker.id),
    repos.sessions.listBySpeaker(speaker.id),
  ]);
  const eventSessions = sessions.filter((session) => session.eventId === eventId);
  return toApiSpeakerDetail(speaker, {
    eventSpeaker: member,
    sessionIds: eventSessions.map((session) => session.id),
    sessions: eventSessions,
  });
}

async function submissionDetail(repos: Repos, eventId: string, submissionId: string) {
  const submission = await repos.submissions.getById(submissionId);
  if (!submission || submission.eventId !== eventId) {
    throw new ApiError(404, "not_found", "Submission not found.");
  }
  const [trackIds, speakerLinks, form, convertedSession] = await Promise.all([
    repos.submissions.listTrackIds(submission.id),
    repos.submissions.listSpeakers(submission.id),
    repos.forms.getById(submission.formId),
    repos.sessions.getBySubmission(submission.id),
  ]);
  const [tracks, people] = await Promise.all([
    repos.tracks.listByIds(trackIds),
    repos.users.listByIds(speakerLinks.map((speaker) => speaker.userId)),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const speakers = speakerLinks.flatMap((link) => {
    const user = peopleById.get(link.userId);
    return user ? [{ user, role: link.role }] : [];
  });
  return toApiSubmissionDetail(submission, {
    tracks,
    speakers,
    form,
    sessionId: convertedSession?.id ?? null,
  });
}

export async function createApiSession(request: Request, eventId: string) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const result = await workflow(() =>
    createSession({ repos: ctx.repos }, eventId, input as CreateSessionInput),
  );
  invalidateEvent(ctx.event.slug);
  return sessionDetail(ctx.repos, eventId, result.session);
}

export async function updateApiSession(
  request: Request,
  eventId: string,
  sessionId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const session = await workflow(() =>
    updateSession(
      { repos: ctx.repos },
      eventId,
      sessionId,
      ctx.actor.id,
      input as UpdateSessionInput,
    ),
  );
  invalidateEvent(ctx.event.slug);
  return sessionDetail(ctx.repos, eventId, session);
}

export async function replaceApiSessionSpeakers(
  request: Request,
  eventId: string,
  sessionId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const speakerIds = isObject(input) ? input.speakerIds : undefined;
  const result = await workflow(() =>
    setSessionSpeakers(
      { repos: ctx.repos },
      eventId,
      sessionId,
      speakerIds as string[],
    ),
  );
  invalidateEvent(ctx.event.slug);
  const current = await ctx.repos.sessions.getById(result.session.id);
  if (!current) throw new ApiError(404, "not_found", "Session not found.");
  return sessionDetail(ctx.repos, eventId, current);
}

export async function placeApiSession(
  request: Request,
  eventId: string,
  sessionId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const result = await workflow(() =>
    placeSession({ repos: ctx.repos }, eventId, sessionId, input as PlaceSessionInput),
  );
  invalidateEvent(ctx.event.slug);
  return {
    session: await sessionDetail(ctx.repos, eventId, result.session),
    conflicts: result.conflicts,
  };
}

export async function unscheduleApiSession(
  request: Request,
  eventId: string,
  sessionId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const session = await workflow(() =>
    unscheduleSession({ repos: ctx.repos }, eventId, sessionId),
  );
  invalidateEvent(ctx.event.slug);
  return sessionDetail(ctx.repos, eventId, session);
}

export async function createApiSpeaker(request: Request, eventId: string) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const result = await workflow(() =>
    createSpeaker({ repos: ctx.repos }, eventId, input as CreateSpeakerInput),
  );
  invalidateEvent(ctx.event.slug);
  return speakerDetail(ctx.repos, eventId, result.speaker);
}

export async function updateApiSpeaker(
  request: Request,
  eventId: string,
  speakerId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const speaker = await workflow(() =>
    updateSpeaker(
      { repos: ctx.repos },
      eventId,
      speakerId,
      input as UpdateSpeakerInput,
    ),
  );
  invalidateEvent(ctx.event.slug);
  return speakerDetail(ctx.repos, eventId, speaker);
}

export async function confirmApiSpeaker(
  request: Request,
  eventId: string,
  speakerId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const confirmation = isObject(input) ? input.confirmation : undefined;
  await workflow(() =>
    setSpeakerConfirmation(
      { repos: ctx.repos },
      eventId,
      speakerId,
      confirmation as "confirmed" | "declined" | null,
    ),
  );
  invalidateEvent(ctx.event.slug);
  const speaker = await ctx.repos.users.getById(speakerId);
  if (!speaker) throw new ApiError(404, "not_found", "Speaker not found.");
  return speakerDetail(ctx.repos, eventId, speaker);
}

export async function decideApiSubmission(
  request: Request,
  eventId: string,
  submissionId: string,
) {
  const ctx = await apiWriteContext(request, eventId);
  const input = await readApiJson(request);
  const comms = await getCommsContext({
    repos: ctx.repos,
    organizerName: ctx.actor.name?.trim() || ctx.actor.email,
    organizerEmail: ctx.actor.email,
  });
  const result = await workflow(() =>
    decideSubmission(
      { repos: ctx.repos, comms },
      eventId,
      submissionId,
      ctx.actor.id,
      input as DecideSubmissionInput,
    ),
  );
  invalidateEvent(ctx.event.slug);
  return {
    submission: await submissionDetail(ctx.repos, eventId, result.submission.id),
    sessionId: result.sessionId,
    sessionCreated: result.sessionCreated,
    assignmentsCreated: result.assignmentsCreated,
    assignmentsRemoved: result.assignmentsRemoved,
    // Deliberately collapse delivery records: addresses and transport details
    // are private and not part of the external DTO contract.
    notified: result.deliveries.length > 0,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
