/**
 * Storage-agnostic organizer workflows shared by the UI, REST API and MCP.
 *
 * Authentication, HTTP envelopes and cache invalidation deliberately live at
 * the edge. This module owns the business write itself and receives only the
 * repository bundle plus optional communication transport.
 */
import { z } from "zod";
import {
  dayStringSchema,
  newSessionSchema,
  newUserSchema,
  sessionContentStatusSchema,
  speakerConfirmationSchema,
  submissionDecisionSchema,
  timeStringSchema,
  type Event,
  type Session,
  type SpeakerConfirmation,
  type SubmissionDecision,
  type User,
} from "@/db/entities";
import type { Repos } from "@/db/repos";
import type { CommsContext } from "@/domain/comms";
import { recordDecision, type RecordDecisionResult } from "@/domain/review";
import {
  CONFLICT_SEVERITY,
  DEFAULT_SESSION_MINUTES,
  detectConflicts,
  durationMinutes,
  enumerateDays,
  firstConflictFreeSlot,
  isValidSessionDuration,
  minutesOfDay,
  preferredSessionDuration,
  type ConflictSeverity,
  type ScheduleConflict,
  type SessionWithSpeakers,
  type SlotSuggestion,
} from "@/domain/scheduling";
import { planAbstractRevision } from "@/domain/session-content";
import { importProfilePatch } from "@/domain/speaker-import";
import { normalizeEmail } from "@/domain/team";

export type AdminWorkflowErrorCode = "validation" | "not_found" | "unavailable";

/** A transport-neutral failure which REST and MCP adapters can map safely. */
export class AdminWorkflowError extends Error {
  constructor(
    public readonly code: AdminWorkflowErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdminWorkflowError";
  }
}

export interface AdminWorkflowContext {
  repos: Repos;
  /** Required only when a submission decision resolves to notify=true. */
  comms?: CommsContext;
  /** Stable clock for slot suggestions and decision timestamps in tests. */
  now?: Date;
}

function invalid(message: string, details?: unknown): never {
  throw new AdminWorkflowError("validation", message, details);
}

function missing(message: string): never {
  throw new AdminWorkflowError("not_found", message);
}

function parsed<T>(result: z.ZodSafeParseResult<T>, fallback: string): T {
  if (!result.success) {
    invalid(
      result.error.issues[0]?.message ?? fallback,
      result.error.flatten(),
    );
  }
  return result.data;
}

async function requireEvent(repos: Repos, eventId: string): Promise<Event> {
  const event = await repos.events.getById(eventId);
  if (!event) missing("Event not found");
  return event;
}

async function requireEventSession(
  repos: Repos,
  eventId: string,
  sessionId: string,
): Promise<Session> {
  const session = await repos.sessions.getById(sessionId);
  if (!session || session.eventId !== eventId) missing("Session not found");
  return session;
}

/** Matches the UI roster's three membership sources (D-051). */
async function requireRosterSpeaker(
  repos: Repos,
  eventId: string,
  speakerId: string,
): Promise<User> {
  const [member, assignments, sessions] = await Promise.all([
    repos.eventSpeakers.get(eventId, speakerId),
    repos.taskAssignments.listByEvent(eventId),
    repos.sessions.listBySpeaker(speakerId),
  ]);
  const onRoster =
    Boolean(member) ||
    assignments.some((assignment) => assignment.speakerId === speakerId) ||
    sessions.some((session) => session.eventId === eventId);
  if (!onRoster) missing("Speaker not found");
  const speaker = await repos.users.getById(speakerId);
  if (!speaker) missing("Speaker not found");
  return speaker;
}

const speakerProfileSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.email("Enter a valid email address"),
  title: z.string().trim().max(120).nullish(),
  company: z.string().trim().max(120).nullish(),
  bio: z.string().trim().max(2000).nullish(),
});

export type CreateSpeakerInput = z.input<typeof speakerProfileSchema>;

export interface CreateSpeakerResult {
  speaker: User;
  created: boolean;
  /** Empty profile fields populated while reusing an existing account. */
  filled: string[];
}

/** Email-deduplicating manual speaker creation, identical to the UI path. */
export async function createSpeaker(
  ctx: AdminWorkflowContext,
  eventId: string,
  input: CreateSpeakerInput,
): Promise<CreateSpeakerResult> {
  await requireEvent(ctx.repos, eventId);
  const value = parsed(
    speakerProfileSchema.safeParse(input),
    "Check those details",
  );
  const email = normalizeEmail(value.email);
  const existing = await ctx.repos.users.getByEmail(email);
  if (existing) {
    const patch = importProfilePatch(existing, {
      name: value.name,
      title: value.title || null,
      company: value.company || null,
      bio: value.bio || null,
    });
    const filled = Object.keys(patch);
    const speaker = filled.length
      ? await ctx.repos.users.update(existing.id, patch)
      : existing;
    await ctx.repos.eventSpeakers.add(eventId, speaker.id);
    return { speaker, created: false, filled };
  }

  const candidate = parsed(
    newUserSchema.safeParse({
      email,
      emailVerified: false,
      name: value.name,
      role: "speaker",
      title: value.title || null,
      company: value.company || null,
      bio: value.bio || null,
      headshotUrl: null,
      websiteUrl: null,
      linkedinUrl: null,
      twitterUrl: null,
      socials: null,
      image: null,
    }),
    "Check those details",
  );
  const speaker = await ctx.repos.users.create(candidate);
  await ctx.repos.eventSpeakers.add(eventId, speaker.id);
  return { speaker, created: true, filled: [] };
}

const speakerPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().max(120).nullable().optional(),
    company: z.string().trim().max(120).nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Supply at least one field",
  );
export type UpdateSpeakerInput = z.input<typeof speakerPatchSchema>;

export async function updateSpeaker(
  ctx: AdminWorkflowContext,
  eventId: string,
  speakerId: string,
  input: UpdateSpeakerInput,
): Promise<User> {
  await requireEvent(ctx.repos, eventId);
  const current = await requireRosterSpeaker(ctx.repos, eventId, speakerId);
  const value = parsed(
    speakerPatchSchema.safeParse(input),
    "Check those details",
  );
  const { notes, ...profile } = value;
  let speaker = current;
  if (Object.keys(profile).length > 0) {
    speaker = await ctx.repos.users.update(speakerId, profile);
  }
  if (notes !== undefined) {
    await ctx.repos.eventSpeakers.setNotes(eventId, speakerId, notes || null);
  }
  return speaker;
}

export async function setSpeakerConfirmation(
  ctx: AdminWorkflowContext,
  eventId: string,
  speakerId: string,
  confirmation: SpeakerConfirmation | null,
) {
  await requireEvent(ctx.repos, eventId);
  await requireRosterSpeaker(ctx.repos, eventId, speakerId);
  const value = parsed(
    speakerConfirmationSchema.nullable().safeParse(confirmation),
    "Invalid confirmation status",
  );
  return ctx.repos.eventSpeakers.setConfirmation(eventId, speakerId, value);
}

const directSpeakerSchema = z.object({
  name: z.string().trim().min(1, "Speaker name is required"),
  email: z.email("Enter a valid email address").transform(normalizeEmail),
});
const createSessionSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().nullish(),
  trackId: z.string().min(1).nullable().optional(),
  speakerIds: z.array(z.string().min(1)).default([]),
  newSpeakers: z.array(directSpeakerSchema).default([]),
});
export type CreateSessionInput = z.input<typeof createSessionSchema>;

export interface SessionMutationResult {
  session: Session;
  speakerIds: string[];
}

export async function createSession(
  ctx: AdminWorkflowContext,
  eventId: string,
  input: CreateSessionInput,
): Promise<SessionMutationResult> {
  await requireEvent(ctx.repos, eventId);
  const value = parsed(createSessionSchema.safeParse(input), "Invalid session");
  if (value.trackId) {
    const track = await ctx.repos.tracks.getById(value.trackId);
    if (!track || track.eventId !== eventId)
      invalid("That track isn't part of this event");
  }

  const speakerIds = new Set(value.speakerIds);
  // IDs are capabilities at this boundary: accepting an arbitrary global user
  // would let an event-scoped credential attach, and then read, a speaker from
  // another event. Typed-in emails still use the intentional cross-event
  // deduplication path below, but supplied IDs must already be on this roster.
  await Promise.all(
    [...speakerIds].map((id) => requireRosterSpeaker(ctx.repos, eventId, id)),
  );
  for (const person of value.newSpeakers) {
    const existing = await ctx.repos.users.getByEmail(person.email);
    if (existing) {
      speakerIds.add(existing.id);
      continue;
    }
    const candidate = parsed(
      newUserSchema.safeParse({
        email: person.email,
        emailVerified: false,
        name: person.name,
        role: "speaker",
        title: null,
        company: null,
        bio: null,
        headshotUrl: null,
        websiteUrl: null,
        linkedinUrl: null,
        twitterUrl: null,
        socials: null,
        image: null,
      }),
      `Couldn't add ${person.email}`,
    );
    speakerIds.add((await ctx.repos.users.create(candidate)).id);
  }

  const candidate = parsed(
    newSessionSchema.safeParse({
      eventId,
      title: value.title,
      description: value.description || null,
      submissionId: null,
      trackId: value.trackId ?? null,
      roomId: null,
      day: null,
      startTime: null,
      endTime: null,
      status: "confirmed",
      contentStatus: "approved",
    }),
    "Invalid session",
  );
  const session = await ctx.repos.sessions.create(candidate);
  const ids = [...speakerIds];
  if (ids.length) await ctx.repos.sessions.setSpeakers(session.id, ids);
  return { session, speakerIds: ids };
}

const updateSessionSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").optional(),
    description: z.string().trim().nullable().optional(),
    trackId: z.string().min(1).nullable().optional(),
    contentStatus: sessionContentStatusSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Supply at least one field",
  );
export type UpdateSessionInput = z.input<typeof updateSessionSchema>;

/** Updates session copy and appends abstract history using the acting admin. */
export async function updateSession(
  ctx: AdminWorkflowContext,
  eventId: string,
  sessionId: string,
  actorUserId: string,
  input: UpdateSessionInput,
): Promise<Session> {
  await requireEvent(ctx.repos, eventId);
  const current = await requireEventSession(ctx.repos, eventId, sessionId);
  const value = parsed(
    updateSessionSchema.safeParse(input),
    "Invalid session details",
  );
  if (value.trackId) {
    const track = await ctx.repos.tracks.getById(value.trackId);
    if (!track || track.eventId !== eventId)
      invalid("That track isn't part of this event");
  }
  const patch = {
    ...value,
    ...(value.description !== undefined
      ? { description: value.description || null }
      : {}),
  };
  const revision =
    value.description !== undefined
      ? planAbstractRevision(current.description, value.description)
      : null;
  const updated = await ctx.repos.sessions.update(sessionId, patch);
  if (revision) {
    await ctx.repos.sessionRevisions.create({
      sessionId,
      field: "abstract",
      priorValue: revision.priorValue,
      newValue: revision.newValue,
      authorUserId: actorUserId,
    });
  }
  return updated;
}

export async function setSessionSpeakers(
  ctx: AdminWorkflowContext,
  eventId: string,
  sessionId: string,
  requestedSpeakerIds: string[],
): Promise<SessionMutationResult> {
  const session = await requireEventSession(ctx.repos, eventId, sessionId);
  const speakerIds = [
    ...new Set(
      parsed(
        z.array(z.string().min(1)).safeParse(requestedSpeakerIds),
        "Invalid speaker list",
      ),
    ),
  ];
  await Promise.all(
    speakerIds.map((id) => requireRosterSpeaker(ctx.repos, eventId, id)),
  );
  await ctx.repos.sessions.setSpeakers(sessionId, speakerIds);
  return { session, speakerIds };
}

const placementSchema = z
  .object({
    day: dayStringSchema,
    startTime: timeStringSchema,
    endTime: timeStringSchema,
    roomId: z.string().min(1).nullable(),
  })
  .refine(
    (value) => minutesOfDay(value.endTime) > minutesOfDay(value.startTime),
    {
      message: "The end time has to be after the start time",
    },
  )
  .refine(
    (value) =>
      isValidSessionDuration(durationMinutes(value.startTime, value.endTime)),
    {
      message:
        "Session length must be a whole number of minutes, between 5 and 480",
    },
  );
export type PlaceSessionInput = z.input<typeof placementSchema>;

export interface ReportedConflict extends ScheduleConflict {
  severity: ConflictSeverity;
}
export interface PlaceSessionResult extends SessionMutationResult {
  conflicts: ReportedConflict[];
}

async function eventSessionsWithSpeakers(
  repos: Repos,
  eventId: string,
): Promise<SessionWithSpeakers[]> {
  const sessions = await repos.sessions.listByEvent(eventId);
  const links = await repos.sessions.listSpeakersBySessionIds(
    sessions.map((session) => session.id),
  );
  const bySession = new Map<string, string[]>();
  for (const link of links) {
    bySession.set(link.sessionId, [
      ...(bySession.get(link.sessionId) ?? []),
      link.userId,
    ]);
  }
  return sessions.map((session) => ({
    ...session,
    speakerIds: bySession.get(session.id) ?? [],
  }));
}

export async function placeSession(
  ctx: AdminWorkflowContext,
  eventId: string,
  sessionId: string,
  input: PlaceSessionInput,
): Promise<PlaceSessionResult> {
  await requireEventSession(ctx.repos, eventId, sessionId);
  const value = parsed(placementSchema.safeParse(input), "Invalid placement");
  if (value.roomId) {
    const room = await ctx.repos.rooms.getById(value.roomId);
    if (!room || room.eventId !== eventId)
      invalid("That room isn't part of this event");
  }
  const session = await ctx.repos.sessions.update(sessionId, value);
  const board = await eventSessionsWithSpeakers(ctx.repos, eventId);
  const speakerIds =
    board.find((row) => row.id === sessionId)?.speakerIds ?? [];
  const conflicts = detectConflicts(board)
    .filter((conflict) => conflict.sessionIds.includes(sessionId))
    .map((conflict) => ({
      ...conflict,
      severity: CONFLICT_SEVERITY[conflict.type],
    }));
  return { session, speakerIds, conflicts };
}

/** Clears only day and room, retaining the remembered duration like the UI. */
export async function unscheduleSession(
  ctx: AdminWorkflowContext,
  eventId: string,
  sessionId: string,
): Promise<Session> {
  await requireEventSession(ctx.repos, eventId, sessionId);
  return ctx.repos.sessions.update(sessionId, { day: null, roomId: null });
}

const suggestionInputSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480).optional(),
  window: z
    .object({
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(1).max(1440),
    })
    .refine(
      (window) => window.endMinute > window.startMinute,
      "Invalid suggestion window",
    )
    .optional(),
});
export type SuggestSessionSlotInput = z.input<typeof suggestionInputSchema>;

export async function suggestSessionSlot(
  ctx: AdminWorkflowContext,
  eventId: string,
  sessionId: string,
  input: SuggestSessionSlotInput = {},
): Promise<SlotSuggestion | null> {
  const value = parsed(
    suggestionInputSchema.safeParse(input),
    "Invalid slot suggestion",
  );
  const [event, session, rooms, board] = await Promise.all([
    requireEvent(ctx.repos, eventId),
    requireEventSession(ctx.repos, eventId, sessionId),
    ctx.repos.rooms.listByEvent(eventId),
    eventSessionsWithSpeakers(ctx.repos, eventId),
  ]);
  const duration =
    value.durationMinutes ??
    preferredSessionDuration(session, DEFAULT_SESSION_MINUTES);
  if (!isValidSessionDuration(duration))
    invalid("Session length must be between 5 and 480 minutes");
  const programmedDays = board.flatMap((row) => (row.day ? [row.day] : []));
  const days = [
    ...new Set([
      ...enumerateDays(event.startDate, event.endDate),
      ...programmedDays,
    ]),
  ].sort();
  if (!days.length)
    days.push((ctx.now ?? new Date()).toISOString().slice(0, 10));
  const target = board.find((row) => row.id === sessionId);
  if (!target) missing("Session not found");
  return firstConflictFreeSlot({
    session: target,
    sessions: board,
    days,
    roomIds: rooms.map((room) => room.id),
    durationMinutes: duration,
    window: value.window,
  });
}

const decideSubmissionSchema = z.object({
  decision: submissionDecisionSchema,
  note: z.string().trim().max(4000, "That note is too long").nullish(),
  notify: z.boolean().optional(),
});
export type DecideSubmissionInput = z.input<typeof decideSubmissionSchema>;

/** D-028 defaults: accept/decline notify; waitlist stays internal. */
export function defaultDecisionNotify(decision: SubmissionDecision): boolean {
  return decision !== "maybe";
}

export async function decideSubmission(
  ctx: AdminWorkflowContext,
  eventId: string,
  submissionId: string,
  actorUserId: string,
  input: DecideSubmissionInput,
): Promise<RecordDecisionResult> {
  const value = parsed(
    decideSubmissionSchema.safeParse(input),
    "Invalid decision",
  );
  const submission = await ctx.repos.submissions.getById(submissionId);
  if (!submission || submission.eventId !== eventId)
    missing("Submission not found");
  const notify = value.notify ?? defaultDecisionNotify(value.decision);
  if (notify && !ctx.comms) {
    throw new AdminWorkflowError(
      "unavailable",
      "Email delivery is not configured",
    );
  }
  return recordDecision(
    { repos: ctx.repos, comms: ctx.comms },
    {
      submissionId,
      decision: value.decision,
      decidedBy: actorUserId,
      note: value.note || null,
      notify,
      now: ctx.now,
    },
  );
}
