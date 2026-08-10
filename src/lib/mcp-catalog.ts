import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  apiDataResponseSchema,
  apiErrorResponseSchema,
  apiEventDetailSchema,
  apiEventListSchema,
  apiPaginatedResponseSchema,
  apiRoomSchema,
  apiSessionDetailSchema,
  apiSessionListSchema,
  apiSpeakerDetailSchema,
  apiSpeakerListSchema,
  apiSubmissionDetailSchema,
  apiSubmissionListSchema,
  apiTaskSchema,
  apiTrackSchema,
} from "@/domain/api-dtos";
import type { McpPermission } from "@/lib/mcp-runtime";

const id = z.string().trim().min(1);
const nullableText = z.string().nullable();
const page = z.number().int().min(1).default(1);
const pageSize = z.number().int().min(1).max(100).default(25);
const sort = z.enum(["createdAt", "updatedAt", "title"]).optional();
const direction = z.enum(["asc", "desc"]).optional();

const paginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

/** REST-compatible success/error envelope advertised as each tool's output. */
export const mcpRestOutputSchema = z
  .object({
    data: z.unknown().optional(),
    pagination: paginationSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
        requestId: z.string(),
      })
      .optional(),
  })
  .passthrough();

const eventConfigurationSchema = z
  .object({
    tracks: z.array(apiTrackSchema),
    rooms: z.array(apiRoomSchema),
    tasks: z.array(apiTaskSchema),
  })
  .strict();
const slotSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    roomId: z.string().nullable(),
  })
  .strict();
const suggestionSchema = z
  .object({ suggestion: slotSchema.nullable(), timezone: z.string() })
  .strict();
const conflictSchema = z
  .object({
    type: z.enum(["speaker_double_booked", "room_double_booked", "track_overlap"]),
    sessionIds: z.tuple([z.string(), z.string()]),
    message: z.string(),
    severity: z.enum(["blocking", "advisory"]),
  })
  .strict();
const placementResultSchema = z
  .object({ session: apiSessionDetailSchema, conflicts: z.array(conflictSchema) })
  .strict();
const decisionResultSchema = z
  .object({
    submission: apiSubmissionDetailSchema,
    sessionId: z.string().nullable(),
    sessionCreated: z.boolean(),
    assignmentsCreated: z.number().int().nonnegative(),
    assignmentsRemoved: z.number().int().nonnegative(),
    notified: z.boolean(),
  })
  .strict();

function resultOrError(result: z.ZodType) {
  return z.union([result, apiErrorResponseSchema]);
}

const MCP_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  list_events: resultOrError(apiPaginatedResponseSchema(apiEventListSchema)),
  get_event: resultOrError(apiDataResponseSchema(apiEventDetailSchema)),
  list_sessions: resultOrError(apiPaginatedResponseSchema(apiSessionListSchema)),
  get_session: resultOrError(apiDataResponseSchema(apiSessionDetailSchema)),
  list_speakers: resultOrError(apiPaginatedResponseSchema(apiSpeakerListSchema)),
  get_speaker: resultOrError(apiDataResponseSchema(apiSpeakerDetailSchema)),
  list_submissions: resultOrError(apiPaginatedResponseSchema(apiSubmissionListSchema)),
  get_submission: resultOrError(apiDataResponseSchema(apiSubmissionDetailSchema)),
  get_event_configuration: resultOrError(apiDataResponseSchema(eventConfigurationSchema)),
  suggest_session_slot: resultOrError(apiDataResponseSchema(suggestionSchema)),
  add_speaker: resultOrError(apiDataResponseSchema(apiSpeakerDetailSchema)),
  update_speaker: resultOrError(apiDataResponseSchema(apiSpeakerDetailSchema)),
  set_speaker_confirmation: resultOrError(apiDataResponseSchema(apiSpeakerDetailSchema)),
  create_session: resultOrError(apiDataResponseSchema(apiSessionDetailSchema)),
  update_session: resultOrError(apiDataResponseSchema(apiSessionDetailSchema)),
  set_session_speakers: resultOrError(apiDataResponseSchema(apiSessionDetailSchema)),
  place_session: resultOrError(apiDataResponseSchema(placementResultSchema)),
  unschedule_session: resultOrError(apiDataResponseSchema(apiSessionDetailSchema)),
  decide_submission: resultOrError(apiDataResponseSchema(decisionResultSchema)),
};

export function mcpOutputSchemaForTool(name: string): z.ZodType {
  return MCP_OUTPUT_SCHEMAS[name] ?? mcpRestOutputSchema;
}

const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function writeAnnotations(options: {
  destructive: boolean;
  idempotent: boolean;
  openWorld?: boolean;
}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: options.destructive,
    idempotentHint: options.idempotent,
    openWorldHint: options.openWorld ?? false,
  };
}

const eventInput = z.object({ eventId: id });
const sessionInput = eventInput.extend({ sessionId: id });
const speakerInput = eventInput.extend({ speakerId: id });
const submissionInput = eventInput.extend({ submissionId: id });
const listBase = {
  eventId: id,
  page,
  pageSize,
  query: z.string().trim().optional(),
  sort,
  direction,
};

export interface GreenroomMcpTool {
  name: string;
  title: string;
  description: string;
  permission: McpPermission;
  inputSchema: z.ZodType<Record<string, unknown>>;
  annotations: ToolAnnotations;
}

export const GREENROOM_MCP_TOOLS: GreenroomMcpTool[] = [
  {
    name: "list_events",
    title: "List events",
    description: "List events available to this credential, newest updates first by default.",
    permission: "read",
    inputSchema: z.object({ page, pageSize, query: z.string().trim().optional(), sort, direction }),
    annotations: readAnnotations,
  },
  {
    name: "get_event",
    title: "Get event",
    description: "Get one event, including its timezone and local agenda date range.",
    permission: "read",
    inputSchema: eventInput,
    annotations: readAnnotations,
  },
  {
    name: "list_sessions",
    title: "List sessions",
    description: "List and filter an event's sessions. Times remain in the event's local timezone.",
    permission: "read",
    inputSchema: z.object({
      ...listBase,
      status: z.enum(["draft", "confirmed", "cancelled"]).optional(),
      contentStatus: z.enum(["draft", "in_review", "approved"]).optional(),
      trackId: id.optional(),
      roomId: id.optional(),
      scheduled: z.boolean().optional(),
    }),
    annotations: readAnnotations,
  },
  {
    name: "get_session",
    title: "Get session",
    description: "Get a session with speakers, placement, and content state.",
    permission: "read",
    inputSchema: sessionInput,
    annotations: readAnnotations,
  },
  {
    name: "list_speakers",
    title: "List speakers",
    description: "List an event's speakers with confirmation status.",
    permission: "read",
    inputSchema: z.object({
      ...listBase,
      confirmation: z.enum(["confirmed", "declined", "unconfirmed"]).optional(),
    }),
    annotations: readAnnotations,
  },
  {
    name: "get_speaker",
    title: "Get speaker",
    description: "Get a speaker's organizer-visible profile, notes, and sessions.",
    permission: "read",
    inputSchema: speakerInput,
    annotations: readAnnotations,
  },
  {
    name: "list_submissions",
    title: "List submissions",
    description: "List and filter an event's submissions.",
    permission: "read",
    inputSchema: z.object({
      ...listBase,
      status: z
        .enum(["draft", "submitted", "approved", "maybe", "denied", "withdrawn"])
        .optional(),
      formId: id.optional(),
      trackId: id.optional(),
    }),
    annotations: readAnnotations,
  },
  {
    name: "get_submission",
    title: "Get submission",
    description: "Get a submission with answers, speakers, tracks, form, and decision state.",
    permission: "read",
    inputSchema: submissionInput,
    annotations: readAnnotations,
  },
  {
    name: "get_event_configuration",
    title: "Get event configuration",
    description: "Get an event's tracks, rooms, and onboarding tasks in one response.",
    permission: "read",
    inputSchema: eventInput,
    annotations: readAnnotations,
  },
  {
    name: "suggest_session_slot",
    title: "Suggest session slot",
    description: "Find the earliest conflict-free placement suggestion for one session.",
    permission: "read",
    inputSchema: sessionInput.extend({
      durationMinutes: z.number().int().min(5).max(480).optional(),
      window: z
        .object({ startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/) })
        .optional(),
    }),
    annotations: readAnnotations,
  },
  {
    name: "add_speaker",
    title: "Add speaker",
    description: "Add or email-deduplicate a speaker on an event roster.",
    permission: "write",
    inputSchema: eventInput.extend({
      name: z.string().trim().min(1).max(120),
      email: z.email(),
      title: z.string().trim().max(120).optional(),
      company: z.string().trim().max(120).optional(),
      bio: z.string().trim().max(2000).optional(),
    }),
    annotations: writeAnnotations({ destructive: false, idempotent: false }),
  },
  {
    name: "update_speaker",
    title: "Update speaker",
    description: "Update organizer-editable speaker profile fields or internal notes.",
    permission: "write",
    inputSchema: speakerInput.extend({
      name: z.string().trim().min(1).max(120).optional(),
      title: nullableText.optional(),
      company: nullableText.optional(),
      bio: nullableText.optional(),
      notes: nullableText.optional(),
    }),
    annotations: writeAnnotations({ destructive: true, idempotent: true }),
  },
  {
    name: "set_speaker_confirmation",
    title: "Set speaker confirmation",
    description: "Set a speaker's confirmation override, or null to resume deriving it from sessions.",
    permission: "write",
    inputSchema: speakerInput.extend({
      confirmation: z.enum(["confirmed", "declined"]).nullable(),
    }),
    annotations: writeAnnotations({ destructive: true, idempotent: true }),
  },
  {
    name: "create_session",
    title: "Create session",
    description: "Create a confirmed direct-entry session, optionally attaching existing or new speakers.",
    permission: "write",
    inputSchema: eventInput.extend({
      title: z.string().trim().min(1),
      description: nullableText.optional(),
      trackId: id.nullable().optional(),
      speakerIds: z.array(id).optional(),
      newSpeakers: z.array(z.object({ name: z.string().trim().min(1), email: z.email() })).optional(),
    }),
    annotations: writeAnnotations({ destructive: false, idempotent: false }),
  },
  {
    name: "update_session",
    title: "Update session",
    description: "Update session copy, track, or content status while preserving abstract revision history.",
    permission: "write",
    inputSchema: sessionInput.extend({
      title: z.string().trim().min(1).optional(),
      description: nullableText.optional(),
      trackId: id.nullable().optional(),
      contentStatus: z.enum(["draft", "in_review", "approved"]).optional(),
    }),
    annotations: writeAnnotations({ destructive: true, idempotent: true }),
  },
  {
    name: "set_session_speakers",
    title: "Set session speakers",
    description: "Replace a session's speaker relationships with the supplied event-roster speakers.",
    permission: "write",
    inputSchema: sessionInput.extend({ speakerIds: z.array(id) }),
    annotations: writeAnnotations({ destructive: true, idempotent: true }),
  },
  {
    name: "place_session",
    title: "Place session",
    description: "Place or move a session and report all resulting blocking and advisory conflicts.",
    permission: "write",
    inputSchema: sessionInput.extend({
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      roomId: id.nullable(),
    }),
    annotations: writeAnnotations({ destructive: true, idempotent: true }),
  },
  {
    name: "unschedule_session",
    title: "Unschedule session",
    description: "Remove a session from the agenda while retaining its remembered duration.",
    permission: "write",
    inputSchema: sessionInput,
    annotations: writeAnnotations({ destructive: true, idempotent: true }),
  },
  {
    name: "decide_submission",
    title: "Decide submission",
    description:
      "Accept, waitlist, or decline a submission through the normal conversion/cancellation workflow. Accept and decline notify by default; waitlist does not. A notified decision sends external email.",
    permission: "write",
    inputSchema: submissionInput.extend({
      decision: z.enum(["approved", "maybe", "denied"]),
      note: nullableText.optional(),
      notify: z.boolean().optional(),
    }),
    annotations: writeAnnotations({ destructive: true, idempotent: false, openWorld: true }),
  },
];

export const GREENROOM_MCP_RESOURCES = [
  {
    name: "events",
    title: "Greenroom events",
    uri: "greenroom://events",
    description: "Events visible to this credential.",
    mimeType: "application/json",
  },
] as const;

export const GREENROOM_MCP_RESOURCE_TEMPLATES = [
  {
    name: "event",
    title: "Event detail",
    uriTemplate: "greenroom://events/{eventId}",
    description: "Organizer-visible event detail.",
  },
  {
    name: "event-agenda",
    title: "Event agenda",
    uriTemplate: "greenroom://events/{eventId}/agenda",
    description: "The event agenda with placements and conflicts.",
  },
  {
    name: "event-session",
    title: "Event session",
    uriTemplate: "greenroom://events/{eventId}/sessions/{sessionId}",
    description: "One event-scoped session.",
  },
  {
    name: "event-speaker",
    title: "Event speaker",
    uriTemplate: "greenroom://events/{eventId}/speakers/{speakerId}",
    description: "One event-scoped speaker record.",
  },
  {
    name: "event-submission",
    title: "Event submission",
    uriTemplate: "greenroom://events/{eventId}/submissions/{submissionId}",
    description: "One event-scoped submission.",
  },
] as const;

export function findMcpTool(name: string): GreenroomMcpTool | undefined {
  return GREENROOM_MCP_TOOLS.find((tool) => tool.name === name);
}
