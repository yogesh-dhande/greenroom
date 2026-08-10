import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Event, EventSpeaker, Session, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import {
  AdminWorkflowError,
  createSession,
  createSpeaker,
  decideSubmission,
  placeSession,
  setSessionSpeakers,
  setSpeakerConfirmation,
  suggestSessionSlot,
  unscheduleSession,
  updateSession,
  updateSpeaker,
} from "@/domain/admin-api";
import {
  toApiEventDetail,
  toApiEventList,
  toApiRoom,
  toApiSessionDetail,
  toApiSessionList,
  toApiSpeakerDetail,
  toApiSpeakerList,
  toApiSubmissionDetail,
  toApiSubmissionList,
  toApiTask,
  toApiTrack,
  type ApiSessionList,
  type ApiSpeakerList,
  type ApiSubmissionList,
} from "@/domain/api-dtos";
import {
  applySessionCollectionQuery,
  applySpeakerCollectionQuery,
  applySubmissionCollectionQuery,
  collectionQuerySchema,
  paginateCollection,
  sessionCollectionQuerySchema,
  sortCollection,
  speakerCollectionQuerySchema,
  submissionCollectionQuerySchema,
} from "@/domain/api-query";
import { minutesOfDay } from "@/domain/scheduling";
import { ApiError } from "@/lib/api-request";
import { getCommsContext } from "@/lib/comms-context";
import { getRepos } from "@/lib/db";
import {
  authenticateExternalRequest,
  ExternalAuthError,
  type ExternalAuthContext,
} from "@/lib/external-auth";
import {
  McpOperationError,
  type GreenroomMcpRuntime,
  type McpExecutionContext,
  type McpOperationResult,
} from "@/lib/mcp-runtime";

function authenticationResponse(error: ExternalAuthError): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (error.status === 429) headers.set("retry-after", "60");
  return new Response(
    JSON.stringify({ error: error.code, error_description: error.message }),
    { status: error.status, headers },
  );
}

function principal(auth: ExternalAuthContext) {
  return {
    userId: auth.ownerId,
    credentialId: auth.credentialId,
    scopes:
      auth.permission === "write"
        ? ["greenroom:read", "greenroom:write"]
        : ["greenroom:read"],
    eventIds: auth.eventScope === "all" ? undefined : auth.eventScope,
  };
}

function eventIdFrom(args: Record<string, unknown>): string | undefined {
  return typeof args.eventId === "string" ? args.eventId : undefined;
}

function enforcePrincipalEvent(context: McpExecutionContext, eventId?: string): void {
  if (!eventId || !context.principal.eventIds) return;
  if (!context.principal.eventIds.includes(eventId)) {
    throw new McpOperationError(404, "not_found", "Event not found.");
  }
}

function mapApplicationError(error: unknown): never {
  if (error instanceof McpOperationError) throw error;
  if (error instanceof ExternalAuthError || error instanceof ApiError) {
    throw new McpOperationError(
      error.status === 401 ? 403 : error.status,
      error.status === 404
        ? "not_found"
        : error.status === 409
          ? "conflict"
          : error.status === 429
            ? "rate_limited"
            : error.status >= 500
              ? "internal_error"
              : error.status === 403
                ? "forbidden"
                : "bad_request",
      error.message,
      error.details,
    );
  }
  if (error instanceof AdminWorkflowError) {
    throw new McpOperationError(
      error.code === "validation" ? 400 : error.code === "not_found" ? 404 : 500,
      error.code === "validation"
        ? "bad_request"
        : error.code === "not_found"
          ? "not_found"
          : "internal_error",
      error.message,
      error.details,
    );
  }
  if (error instanceof z.ZodError) {
    throw new McpOperationError(400, "bad_request", "The request parameters are invalid.", error.issues);
  }
  throw error;
}

async function requireEvent(repos: Repos, eventId: string): Promise<Event> {
  const event = await repos.events.getById(eventId);
  if (!event) throw new McpOperationError(404, "not_found", "Event not found.");
  return event;
}

function invalidateEvent(eventSlug: string): void {
  revalidatePath(`/admin/${eventSlug}`, "layout");
  revalidatePath(`/p/${eventSlug}`, "layout");
  revalidatePath(`/p/${eventSlug}/feed.json`);
  revalidatePath(`/p/${eventSlug}/feed.xml`);
  revalidatePath(`/p/${eventSlug}/feed.ics`);
  revalidatePath(`/embed/${eventSlug}`, "layout");
}

function groupIds<T, K1 extends keyof T, K2 extends keyof T>(
  rows: T[],
  groupKey: K1,
  valueKey: K2,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = String(row[groupKey]);
    grouped.set(key, [...(grouped.get(key) ?? []), String(row[valueKey])]);
  }
  return grouped;
}

async function sessionRows(repos: Repos, eventId: string): Promise<ApiSessionList[]> {
  const [sessions, tracks, rooms] = await Promise.all([
    repos.sessions.listByEvent(eventId),
    repos.tracks.listByEvent(eventId),
    repos.rooms.listByEvent(eventId),
  ]);
  const links = await repos.sessions.listSpeakersBySessionIds(sessions.map((session) => session.id));
  const speakerIdsBySession = groupIds(links, "sessionId", "userId");
  const people = await repos.users.listByIds([...new Set(links.map((link) => link.userId))]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return sessions.map((session) =>
    toApiSessionList(session, {
      speakers: (speakerIdsBySession.get(session.id) ?? []).flatMap((id) =>
        peopleById.has(id) ? [peopleById.get(id)!] : [],
      ),
      track: session.trackId ? (trackById.get(session.trackId) ?? null) : null,
      room: session.roomId ? (roomById.get(session.roomId) ?? null) : null,
    }),
  );
}

async function sessionDetail(repos: Repos, eventId: string, session: Session) {
  if (session.eventId !== eventId) throw new McpOperationError(404, "not_found", "Session not found.");
  const [links, track, room] = await Promise.all([
    repos.sessions.listSpeakersBySessionIds([session.id]),
    session.trackId ? repos.tracks.getById(session.trackId) : Promise.resolve(null),
    session.roomId ? repos.rooms.getById(session.roomId) : Promise.resolve(null),
  ]);
  const speakers = await repos.users.listByIds(links.map((link) => link.userId));
  return toApiSessionDetail(session, { speakers, track, room });
}

interface SpeakerRows {
  list: ApiSpeakerList[];
  byId: Map<string, { user: User; member: EventSpeaker | null; sessionIds: string[] }>;
}

async function speakerRows(repos: Repos, eventId: string): Promise<SpeakerRows> {
  const [sessions, assignments, members] = await Promise.all([
    repos.sessions.listByEvent(eventId),
    repos.taskAssignments.listByEvent(eventId),
    repos.eventSpeakers.listByEvent(eventId),
  ]);
  const links = await repos.sessions.listSpeakersBySessionIds(sessions.map((session) => session.id));
  const sessionIdsBySpeaker = groupIds(links, "userId", "sessionId");
  const memberBySpeaker = new Map(members.map((member) => [member.userId, member]));
  const speakerIds = new Set([
    ...memberBySpeaker.keys(),
    ...sessionIdsBySpeaker.keys(),
    ...assignments.map((assignment) => assignment.speakerId),
  ]);
  const people = await repos.users.listByIds([...speakerIds]);
  const byId = new Map(
    people.map((user) => [
      user.id,
      {
        user,
        member: memberBySpeaker.get(user.id) ?? null,
        sessionIds: sessionIdsBySpeaker.get(user.id) ?? [],
      },
    ] as const),
  );
  return {
    byId,
    list: [...byId.values()].map(({ user, member, sessionIds }) =>
      toApiSpeakerList(user, { eventSpeaker: member, sessionIds }),
    ),
  };
}

async function speakerDetail(repos: Repos, eventId: string, speakerId: string) {
  const row = (await speakerRows(repos, eventId)).byId.get(speakerId);
  if (!row) throw new McpOperationError(404, "not_found", "Speaker not found.");
  const sessions = await repos.sessions.listByEvent(eventId);
  const sessionIds = new Set(row.sessionIds);
  return toApiSpeakerDetail(row.user, {
    eventSpeaker: row.member,
    sessionIds: row.sessionIds,
    sessions: sessions.filter((session) => sessionIds.has(session.id)),
  });
}

async function submissionRows(repos: Repos, eventId: string): Promise<ApiSubmissionList[]> {
  const submissions = await repos.submissions.listByEvent(eventId);
  const [trackLinks, speakerLinks] = await Promise.all([
    repos.submissions.listTracksBySubmissionIds(submissions.map((submission) => submission.id)),
    repos.submissions.listSpeakersBySubmissionIds(submissions.map((submission) => submission.id)),
  ]);
  const trackIdsBySubmission = groupIds(trackLinks, "submissionId", "trackId");
  const [tracks, people] = await Promise.all([
    repos.tracks.listByEvent(eventId),
    repos.users.listByIds([...new Set(speakerLinks.map((link) => link.userId))]),
  ]);
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const speakersBySubmission = new Map<string, Array<{ user: User; role: (typeof speakerLinks)[number]["role"] }>>();
  for (const link of speakerLinks) {
    const user = peopleById.get(link.userId);
    if (!user) continue;
    speakersBySubmission.set(link.submissionId, [
      ...(speakersBySubmission.get(link.submissionId) ?? []),
      { user, role: link.role },
    ]);
  }
  return submissions.map((submission) =>
    toApiSubmissionList(submission, {
      tracks: (trackIdsBySubmission.get(submission.id) ?? []).flatMap((id) =>
        trackById.has(id) ? [trackById.get(id)!] : [],
      ),
      speakers: speakersBySubmission.get(submission.id) ?? [],
    }),
  );
}

async function submissionDetail(repos: Repos, eventId: string, submissionId: string) {
  const submission = await repos.submissions.getById(submissionId);
  if (!submission || submission.eventId !== eventId) {
    throw new McpOperationError(404, "not_found", "Submission not found.");
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
  return toApiSubmissionDetail(submission, {
    tracks,
    speakers: speakerLinks.flatMap((link) => {
      const user = peopleById.get(link.userId);
      return user ? [{ user, role: link.role }] : [];
    }),
    form,
    sessionId: convertedSession?.id ?? null,
  });
}

async function actorAndEvent(repos: Repos, context: McpExecutionContext, eventId: string) {
  enforcePrincipalEvent(context, eventId);
  const [actor, event] = await Promise.all([
    repos.users.getById(context.principal.userId),
    requireEvent(repos, eventId),
  ]);
  if (!actor || actor.role !== "admin") {
    throw new McpOperationError(403, "forbidden", "The credential owner is no longer an admin.");
  }
  return { actor, event };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: McpExecutionContext,
): Promise<McpOperationResult> {
  const repos = await getRepos();
  const eventId = eventIdFrom(args);
  enforcePrincipalEvent(context, eventId);

  switch (name) {
    case "list_events": {
      const query = collectionQuerySchema.parse(args);
      let rows = (await repos.events.listAll())
        .filter((event) => !context.principal.eventIds || context.principal.eventIds.includes(event.id))
        .map(toApiEventList);
      if (query.query) {
        const needle = query.query.toLocaleLowerCase();
        rows = rows.filter((event) =>
          [event.name, event.slug, event.location].some((value) =>
            (value ?? "").toLocaleLowerCase().includes(needle),
          ),
        );
      }
      const result = paginateCollection(
        sortCollection(rows, query.sort, query.direction),
        query.page,
        query.pageSize,
      );
      return { envelope: result };
    }
    case "get_event": {
      const event = await requireEvent(repos, args.eventId as string);
      return { envelope: { data: toApiEventDetail(event) }, summary: `Retrieved ${event.name}.` };
    }
    case "list_sessions": {
      await requireEvent(repos, args.eventId as string);
      const queryInput: Record<string, unknown> = {
        ...args,
        track: args.trackId,
        room: args.roomId,
      };
      delete queryInput.eventId;
      delete queryInput.trackId;
      delete queryInput.roomId;
      const query = sessionCollectionQuerySchema.parse(queryInput);
      return { envelope: applySessionCollectionQuery(await sessionRows(repos, args.eventId as string), query) };
    }
    case "get_session": {
      await requireEvent(repos, args.eventId as string);
      const session = await repos.sessions.getById(args.sessionId as string);
      if (!session || session.eventId !== args.eventId) {
        throw new McpOperationError(404, "not_found", "Session not found.");
      }
      return { envelope: { data: await sessionDetail(repos, args.eventId as string, session) } };
    }
    case "list_speakers": {
      await requireEvent(repos, args.eventId as string);
      const queryInput = { ...args };
      delete queryInput.eventId;
      const query = speakerCollectionQuerySchema.parse(queryInput);
      return { envelope: applySpeakerCollectionQuery((await speakerRows(repos, args.eventId as string)).list, query) };
    }
    case "get_speaker":
      await requireEvent(repos, args.eventId as string);
      return { envelope: { data: await speakerDetail(repos, args.eventId as string, args.speakerId as string) } };
    case "list_submissions": {
      await requireEvent(repos, args.eventId as string);
      const queryInput: Record<string, unknown> = {
        ...args,
        form: args.formId,
        track: args.trackId,
      };
      delete queryInput.eventId;
      delete queryInput.formId;
      delete queryInput.trackId;
      const query = submissionCollectionQuerySchema.parse(queryInput);
      return { envelope: applySubmissionCollectionQuery(await submissionRows(repos, args.eventId as string), query) };
    }
    case "get_submission":
      await requireEvent(repos, args.eventId as string);
      return { envelope: { data: await submissionDetail(repos, args.eventId as string, args.submissionId as string) } };
    case "get_event_configuration": {
      await requireEvent(repos, args.eventId as string);
      const [tracks, rooms, tasks] = await Promise.all([
        repos.tracks.listByEvent(args.eventId as string),
        repos.rooms.listByEvent(args.eventId as string),
        repos.tasks.listByEvent(args.eventId as string),
      ]);
      return {
        envelope: {
          data: { tracks: tracks.map(toApiTrack), rooms: rooms.map(toApiRoom), tasks: tasks.map(toApiTask) },
        },
      };
    }
    case "suggest_session_slot": {
      const event = await requireEvent(repos, args.eventId as string);
      const rawWindow = args.window as { startTime: string; endTime: string } | undefined;
      const suggestion = await suggestSessionSlot(
        { repos },
        args.eventId as string,
        args.sessionId as string,
        {
          durationMinutes: args.durationMinutes as number | undefined,
          window: rawWindow
            ? { startMinute: minutesOfDay(rawWindow.startTime), endMinute: minutesOfDay(rawWindow.endTime) }
            : undefined,
        },
      );
      return { envelope: { data: { suggestion, timezone: event.timezone } } };
    }
    case "add_speaker": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      const input = { ...args };
      delete input.eventId;
      const result = await createSpeaker({ repos }, event.id, input as never);
      invalidateEvent(event.slug);
      return { envelope: { data: await speakerDetail(repos, event.id, result.speaker.id) } };
    }
    case "update_speaker": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      const input = { ...args };
      delete input.eventId;
      delete input.speakerId;
      const speakerId = args.speakerId;
      const speaker = await updateSpeaker({ repos }, event.id, speakerId as string, input);
      invalidateEvent(event.slug);
      return { envelope: { data: await speakerDetail(repos, event.id, speaker.id) } };
    }
    case "set_speaker_confirmation": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      await setSpeakerConfirmation(
        { repos },
        event.id,
        args.speakerId as string,
        args.confirmation as "confirmed" | "declined" | null,
      );
      invalidateEvent(event.slug);
      return { envelope: { data: await speakerDetail(repos, event.id, args.speakerId as string) } };
    }
    case "create_session": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      const input = { ...args };
      delete input.eventId;
      const result = await createSession({ repos }, event.id, input as never);
      invalidateEvent(event.slug);
      return { envelope: { data: await sessionDetail(repos, event.id, result.session) } };
    }
    case "update_session": {
      const { actor, event } = await actorAndEvent(repos, context, args.eventId as string);
      const input = { ...args };
      delete input.eventId;
      delete input.sessionId;
      const sessionId = args.sessionId;
      const result = await updateSession({ repos }, event.id, sessionId as string, actor.id, input);
      invalidateEvent(event.slug);
      return { envelope: { data: await sessionDetail(repos, event.id, result) } };
    }
    case "set_session_speakers": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      const result = await setSessionSpeakers(
        { repos },
        event.id,
        args.sessionId as string,
        args.speakerIds as string[],
      );
      invalidateEvent(event.slug);
      const session = await repos.sessions.getById(result.session.id);
      if (!session) throw new McpOperationError(404, "not_found", "Session not found.");
      return { envelope: { data: await sessionDetail(repos, event.id, session) } };
    }
    case "place_session": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      const input = { ...args };
      delete input.eventId;
      delete input.sessionId;
      const sessionId = args.sessionId;
      const result = await placeSession({ repos }, event.id, sessionId as string, input as never);
      invalidateEvent(event.slug);
      return {
        envelope: {
          data: { session: await sessionDetail(repos, event.id, result.session), conflicts: result.conflicts },
        },
      };
    }
    case "unschedule_session": {
      const { event } = await actorAndEvent(repos, context, args.eventId as string);
      const result = await unscheduleSession({ repos }, event.id, args.sessionId as string);
      invalidateEvent(event.slug);
      return { envelope: { data: await sessionDetail(repos, event.id, result) } };
    }
    case "decide_submission": {
      const { actor, event } = await actorAndEvent(repos, context, args.eventId as string);
      const comms = await getCommsContext({
        repos,
        organizerName: actor.name?.trim() || actor.email,
        organizerEmail: actor.email,
      });
      const result = await decideSubmission(
        { repos, comms },
        event.id,
        args.submissionId as string,
        actor.id,
        {
          decision: args.decision as "approved" | "maybe" | "denied",
          note: args.note as string | null | undefined,
          notify: args.notify as boolean | undefined,
        },
      );
      invalidateEvent(event.slug);
      return {
        envelope: {
          data: {
            submission: await submissionDetail(repos, event.id, result.submission.id),
            sessionId: result.sessionId,
            sessionCreated: result.sessionCreated,
            assignmentsCreated: result.assignmentsCreated,
            assignmentsRemoved: result.assignmentsRemoved,
            notified: result.deliveries.length > 0,
          },
        },
      };
    }
    default:
      throw new McpOperationError(404, "not_found", "Tool not found.");
  }
}

async function readResource(
  uri: string,
  context: McpExecutionContext,
): Promise<McpOperationResult> {
  const parsed = new URL(uri);
  if (parsed.protocol !== "greenroom:" || parsed.hostname !== "events") {
    throw new McpOperationError(404, "not_found", "Resource not found.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) {
    return executeTool("list_events", { page: 1, pageSize: 25 }, context);
  }
  const [eventId, kind, childId] = segments;
  if (!kind) return executeTool("get_event", { eventId }, context);
  if (kind === "sessions" && childId) {
    return executeTool("get_session", { eventId, sessionId: childId }, context);
  }
  if (kind === "speakers" && childId) {
    return executeTool("get_speaker", { eventId, speakerId: childId }, context);
  }
  if (kind === "submissions" && childId) {
    return executeTool("get_submission", { eventId, submissionId: childId }, context);
  }
  if (kind === "agenda" && !childId) {
    const repos = await getRepos();
    enforcePrincipalEvent(context, eventId);
    const event = await requireEvent(repos, eventId);
    return {
      envelope: {
        data: {
          event: toApiEventDetail(event),
          sessions: await sessionRows(repos, eventId),
          timezone: event.timezone,
        },
      },
    };
  }
  throw new McpOperationError(404, "not_found", "Resource not found.");
}

export const productionMcpRuntime: GreenroomMcpRuntime = {
  async authenticate(request) {
    try {
      return { ok: true, principal: principal(await authenticateExternalRequest(request)) };
    } catch (error) {
      if (error instanceof ExternalAuthError) {
        return { ok: false, response: authenticationResponse(error) };
      }
      return {
        ok: false,
        response: Response.json(
          { error: "server_error", error_description: "Authentication is unavailable." },
          { status: 500 },
        ),
      };
    }
  },
  async callTool(name, args, context) {
    try {
      return await executeTool(name, args, context);
    } catch (error) {
      mapApplicationError(error);
    }
  },
  async readResource(uri, context) {
    try {
      return await readResource(uri, context);
    } catch (error) {
      mapApplicationError(error);
    }
  },
};
