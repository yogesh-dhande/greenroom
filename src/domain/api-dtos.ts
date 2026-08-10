/**
 * Stable public DTOs for the authenticated API and MCP server.
 *
 * These schemas deliberately do not reuse entity schemas. Database entities
 * include authentication and capability-bearing fields (for example a
 * submission resume token), while the public contract must remain explicit
 * and safe as entities evolve.
 */
import { z } from "zod";

import type {
  Event,
  EventSpeaker,
  Form,
  Room,
  Session,
  SpeakerRole,
  Submission,
  Task,
  Track,
  User,
} from "@/db/entities";

const nullableIsoDateTimeSchema = z.iso.datetime().nullable();
const isoDateTimeSchema = z.iso.datetime();
const nullableDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const nullableTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

const timestampsSchema = {
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

function iso(date: Date): string {
  return date.toISOString();
}

function nullableIso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

// ---------------------------------------------------------------------------
// Shared response envelopes and errors
// ---------------------------------------------------------------------------

export const apiPaginationSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type ApiPagination = z.infer<typeof apiPaginationSchema>;

export interface ApiDataResponse<T> {
  data: T;
}

export interface ApiPaginatedResponse<T> {
  data: T[];
  pagination: ApiPagination;
}

export function apiDataResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({ data: dataSchema }).strict();
}

export function apiPaginatedResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z
    .object({
      data: z.array(dataSchema),
      pagination: apiPaginationSchema,
    })
    .strict();
}

export const apiErrorCodeSchema = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiErrorResponseSchema = z.object({ error: apiErrorSchema }).strict();
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export function toApiErrorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}

// ---------------------------------------------------------------------------
// Event configuration
// ---------------------------------------------------------------------------

export const apiEventListSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    startDate: nullableDaySchema,
    endDate: nullableDaySchema,
    timezone: z.string(),
    location: z.string().nullable(),
    programPublished: z.boolean(),
    ...timestampsSchema,
  })
  .strict();
export type ApiEventList = z.infer<typeof apiEventListSchema>;

export const apiEventDetailSchema = apiEventListSchema
  .extend({ description: z.string().nullable() })
  .strict();
export type ApiEventDetail = z.infer<typeof apiEventDetailSchema>;

export function toApiEventList(event: Event): ApiEventList {
  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    startDate: event.startDate,
    endDate: event.endDate,
    timezone: event.timezone,
    location: event.location,
    programPublished: event.programPublished,
    createdAt: iso(event.createdAt),
    updatedAt: iso(event.updatedAt),
  };
}

export function toApiEventDetail(event: Event): ApiEventDetail {
  return { ...toApiEventList(event), description: event.description };
}

export const apiTrackSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    name: z.string(),
    color: z.string().nullable(),
    ...timestampsSchema,
  })
  .strict();
export type ApiTrack = z.infer<typeof apiTrackSchema>;

export function toApiTrack(track: Track): ApiTrack {
  return {
    id: track.id,
    eventId: track.eventId,
    name: track.name,
    color: track.color,
    createdAt: iso(track.createdAt),
    updatedAt: iso(track.updatedAt),
  };
}

export const apiRoomSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    name: z.string(),
    capacity: z.number().int().nullable(),
    ...timestampsSchema,
  })
  .strict();
export type ApiRoom = z.infer<typeof apiRoomSchema>;

export function toApiRoom(room: Room): ApiRoom {
  return {
    id: room.id,
    eventId: room.eventId,
    name: room.name,
    capacity: room.capacity,
    createdAt: iso(room.createdAt),
    updatedAt: iso(room.updatedAt),
  };
}

export const apiTaskSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    title: z.string(),
    instructions: z.string().nullable(),
    type: z.enum(["form", "file_request", "confirm"]),
    formId: z.string().nullable(),
    dueAt: nullableIsoDateTimeSchema,
    autoAssignOnAccept: z.boolean(),
    ...timestampsSchema,
  })
  .strict();
export type ApiTask = z.infer<typeof apiTaskSchema>;

export function toApiTask(task: Task): ApiTask {
  return {
    id: task.id,
    eventId: task.eventId,
    title: task.title,
    instructions: task.instructions,
    type: task.type,
    formId: task.formId,
    dueAt: nullableIso(task.dueAt),
    autoAssignOnAccept: task.autoAssignOnAccept,
    createdAt: iso(task.createdAt),
    updatedAt: iso(task.updatedAt),
  };
}

const apiNamedReferenceSchema = z.object({ id: z.string(), name: z.string() }).strict();
export type ApiNamedReference = z.infer<typeof apiNamedReferenceSchema>;

function namedReference(entity: Pick<Track | Room | Form, "id" | "name">): ApiNamedReference {
  return { id: entity.id, name: entity.name };
}

// ---------------------------------------------------------------------------
// Speakers
// ---------------------------------------------------------------------------

export const apiConfirmationStatusSchema = z.enum(["unconfirmed", "confirmed", "declined"]);
export type ApiConfirmationStatus = z.infer<typeof apiConfirmationStatusSchema>;

export const apiConfirmationSourceSchema = z.enum(["automatic", "override"]);
export type ApiConfirmationSource = z.infer<typeof apiConfirmationSourceSchema>;

export function deriveApiConfirmation(
  stored: EventSpeaker["confirmationStatus"] | null | undefined,
  hasSession: boolean,
): { status: ApiConfirmationStatus; source: ApiConfirmationSource } {
  if (stored === "confirmed") return { status: "confirmed", source: "override" };
  if (stored === "declined") return { status: "declined", source: "override" };
  return {
    status: hasSession ? "confirmed" : "unconfirmed",
    source: "automatic",
  };
}

export const apiSpeakerSummarySchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    title: z.string().nullable(),
    company: z.string().nullable(),
    headshotUrl: z.string().nullable(),
  })
  .strict();
export type ApiSpeakerSummary = z.infer<typeof apiSpeakerSummarySchema>;

export function toApiSpeakerSummary(user: User): ApiSpeakerSummary {
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    company: user.company,
    headshotUrl: user.headshotUrl,
  };
}

export interface ApiSpeakerContext {
  eventSpeaker?: EventSpeaker | null;
  sessionIds?: readonly string[];
}

export const apiSpeakerListSchema = apiSpeakerSummarySchema
  .extend({
    confirmationStatus: apiConfirmationStatusSchema,
    confirmationSource: apiConfirmationSourceSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type ApiSpeakerList = z.infer<typeof apiSpeakerListSchema>;

export function toApiSpeakerList(user: User, context: ApiSpeakerContext = {}): ApiSpeakerList {
  const confirmation = deriveApiConfirmation(
    context.eventSpeaker?.confirmationStatus,
    (context.sessionIds?.length ?? 0) > 0,
  );
  return {
    ...toApiSpeakerSummary(user),
    confirmationStatus: confirmation.status,
    confirmationSource: confirmation.source,
    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
  };
}

export const apiSpeakerSessionReferenceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["draft", "confirmed", "cancelled"]),
    schedulingStatus: z.enum(["scheduled", "unscheduled"]),
  })
  .strict();

export const apiSpeakerDetailSchema = apiSpeakerListSchema
  .extend({
    email: z.email(),
    bio: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    linkedinUrl: z.string().nullable(),
    twitterUrl: z.string().nullable(),
    notes: z.string().nullable(),
    sessions: z.array(apiSpeakerSessionReferenceSchema),
  })
  .strict();
export type ApiSpeakerDetail = z.infer<typeof apiSpeakerDetailSchema>;

export interface ApiSpeakerDetailContext extends ApiSpeakerContext {
  sessions?: readonly Session[];
}

export function toApiSpeakerDetail(
  user: User,
  context: ApiSpeakerDetailContext = {},
): ApiSpeakerDetail {
  const sessions = context.sessions ?? [];
  const sessionIds = context.sessionIds ?? sessions.map((session) => session.id);
  return {
    ...toApiSpeakerList(user, { ...context, sessionIds }),
    email: user.email,
    bio: user.bio,
    websiteUrl: user.websiteUrl,
    linkedinUrl: user.linkedinUrl,
    twitterUrl: user.twitterUrl,
    notes: context.eventSpeaker?.notes ?? null,
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      status: session.status,
      schedulingStatus: deriveSchedulingStatus(session),
    })),
  };
}

export const apiSpeakerWithEmailSchema = apiSpeakerSummarySchema
  .extend({ email: z.email() })
  .strict();
export type ApiSpeakerWithEmail = z.infer<typeof apiSpeakerWithEmailSchema>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const apiSchedulingStatusSchema = z.enum(["scheduled", "unscheduled"]);
export type ApiSchedulingStatus = z.infer<typeof apiSchedulingStatusSchema>;

export function deriveSchedulingStatus(
  session: Pick<Session, "day" | "startTime" | "endTime">,
): ApiSchedulingStatus {
  return session.day && session.startTime && session.endTime ? "scheduled" : "unscheduled";
}

export interface ApiSessionContext {
  speakers?: readonly User[];
  track?: Track | null;
  room?: Room | null;
}

export const apiSessionListSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    title: z.string(),
    status: z.enum(["draft", "confirmed", "cancelled"]),
    contentStatus: z.enum(["draft", "in_review", "approved"]),
    schedulingStatus: apiSchedulingStatusSchema,
    track: apiNamedReferenceSchema.nullable(),
    room: apiNamedReferenceSchema.nullable(),
    day: nullableDaySchema,
    startTime: nullableTimeSchema,
    endTime: nullableTimeSchema,
    speakers: z.array(apiSpeakerSummarySchema),
    ...timestampsSchema,
  })
  .strict();
export type ApiSessionList = z.infer<typeof apiSessionListSchema>;

export function toApiSessionList(
  session: Session,
  context: ApiSessionContext = {},
): ApiSessionList {
  return {
    id: session.id,
    eventId: session.eventId,
    title: session.title,
    status: session.status,
    contentStatus: session.contentStatus,
    schedulingStatus: deriveSchedulingStatus(session),
    track: context.track ? namedReference(context.track) : null,
    room: context.room ? namedReference(context.room) : null,
    day: session.day,
    startTime: session.startTime,
    endTime: session.endTime,
    speakers: (context.speakers ?? []).map(toApiSpeakerSummary),
    createdAt: iso(session.createdAt),
    updatedAt: iso(session.updatedAt),
  };
}

export const apiSessionDetailSchema = apiSessionListSchema
  .omit({ speakers: true })
  .extend({
    description: z.string().nullable(),
    submissionId: z.string().nullable(),
    speakers: z.array(apiSpeakerWithEmailSchema),
  })
  .strict();
export type ApiSessionDetail = z.infer<typeof apiSessionDetailSchema>;

export function toApiSessionDetail(
  session: Session,
  context: ApiSessionContext = {},
): ApiSessionDetail {
  const list = toApiSessionList(session, context);
  return {
    ...list,
    description: session.description,
    submissionId: session.submissionId,
    speakers: (context.speakers ?? []).map((speaker) => ({
      ...toApiSpeakerSummary(speaker),
      email: speaker.email,
    })),
  };
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export const apiSubmissionSpeakerSchema = apiSpeakerSummarySchema
  .extend({ role: z.enum(["primary", "co"]) })
  .strict();
export type ApiSubmissionSpeaker = z.infer<typeof apiSubmissionSpeakerSchema>;

export const apiSubmissionSpeakerDetailSchema = apiSubmissionSpeakerSchema
  .extend({ email: z.email() })
  .strict();

export interface ApiSubmissionSpeakerInput {
  user: User;
  role: SpeakerRole;
}

export interface ApiSubmissionContext {
  tracks?: readonly Track[];
  speakers?: readonly ApiSubmissionSpeakerInput[];
  form?: Form | null;
  sessionId?: string | null;
}

export const apiSubmissionListSchema = z
  .object({
    id: z.string(),
    eventId: z.string(),
    formId: z.string(),
    title: z.string(),
    status: z.enum(["draft", "submitted", "approved", "maybe", "denied", "withdrawn"]),
    tracks: z.array(apiNamedReferenceSchema),
    speakers: z.array(apiSubmissionSpeakerSchema),
    ...timestampsSchema,
  })
  .strict();
export type ApiSubmissionList = z.infer<typeof apiSubmissionListSchema>;

export function toApiSubmissionList(
  submission: Submission,
  context: ApiSubmissionContext = {},
): ApiSubmissionList {
  return {
    id: submission.id,
    eventId: submission.eventId,
    formId: submission.formId,
    title: submission.title,
    status: submission.status,
    tracks: (context.tracks ?? []).map(namedReference),
    speakers: (context.speakers ?? []).map(({ user, role }) => ({
      ...toApiSpeakerSummary(user),
      role,
    })),
    createdAt: iso(submission.createdAt),
    updatedAt: iso(submission.updatedAt),
  };
}

export const apiSubmissionDetailSchema = apiSubmissionListSchema
  .omit({ speakers: true })
  .extend({
    description: z.string().nullable(),
    answers: z.record(z.string(), z.unknown()),
    form: apiNamedReferenceSchema.nullable(),
    speakers: z.array(apiSubmissionSpeakerDetailSchema),
    sessionId: z.string().nullable(),
    decision: z
      .object({
        decidedBy: z.string().nullable(),
        decidedAt: nullableIsoDateTimeSchema,
        note: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
export type ApiSubmissionDetail = z.infer<typeof apiSubmissionDetailSchema>;

export function toApiSubmissionDetail(
  submission: Submission,
  context: ApiSubmissionContext = {},
): ApiSubmissionDetail {
  const list = toApiSubmissionList(submission, context);
  return {
    ...list,
    description: submission.description,
    answers: submission.answers,
    form: context.form ? namedReference(context.form) : null,
    speakers: (context.speakers ?? []).map(({ user, role }) => ({
      ...toApiSpeakerSummary(user),
      email: user.email,
      role,
    })),
    sessionId: context.sessionId ?? null,
    decision: {
      decidedBy: submission.decidedBy,
      decidedAt: nullableIso(submission.decidedAt),
      note: submission.decisionNote,
    },
  };
}
