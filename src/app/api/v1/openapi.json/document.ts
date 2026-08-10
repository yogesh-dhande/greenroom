const jsonContent = (schema: object) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const dataEnvelope = (name: string) => ({
  type: "object",
  required: ["data"],
  additionalProperties: false,
  properties: { data: ref(name) },
});
const collectionEnvelope = (name: string) => ({
  type: "object",
  required: ["data", "pagination"],
  additionalProperties: false,
  properties: { data: { type: "array", items: ref(name) }, pagination: ref("Pagination") },
});
const success = (name: string, collection = false, description = "Successful response") => ({
  description,
  content: jsonContent(collection ? collectionEnvelope(name) : dataEnvelope(name)),
});
const error = {
  description: "Error response",
  content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
};
const standardErrors = {
  "400": error,
  "401": error,
  "403": error,
  "404": error,
  "409": error,
  "429": { ...error, headers: { "Retry-After": { schema: { type: "integer" } } } },
  "500": error,
};

const eventId = {
  name: "eventId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;
const pagination = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  {
    name: "pageSize",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  {
    name: "sort",
    in: "query",
    schema: { type: "string", enum: ["createdAt", "updatedAt", "title"], default: "updatedAt" },
  },
  { name: "direction", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
] as const;

const readOperation = (
  summary: string,
  responseSchema: string,
  parameters: readonly object[] = [],
  collection = false,
) => ({
  summary,
  security: [{ ApiKey: ["greenroom:read"] }, { OAuth2: ["greenroom:read"] }],
  parameters,
  responses: { "200": success(responseSchema, collection), ...standardErrors },
});
const writeOperation = (
  summary: string,
  parameters: readonly object[],
  requestSchema: string,
  responseSchema: string,
  method: "post" | "patch" | "put" = "post",
  status = method === "post" ? "201" : "200",
) => ({
  [method]: {
    summary,
    security: [{ ApiKey: ["greenroom:write"] }, { OAuth2: ["greenroom:write"] }],
    parameters,
    requestBody: { required: true, content: jsonContent(ref(requestSchema)) },
    responses: { [status]: success(responseSchema, false, status === "201" ? "Created" : "Successful response"), ...standardErrors },
  },
});

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Greenroom Core API",
    version: "1.0.0",
    description:
      "Admin-only event, session, speaker, and submission workflows. Dates are ISO-8601; agenda days and wall-clock times use the event timezone returned by the event resource.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [
    { name: "Events" },
    { name: "Sessions" },
    { name: "Speakers" },
    { name: "Submissions" },
  ],
  paths: {
    "/events": {
      get: { ...readOperation("List accessible events", "EventList", pagination, true), tags: ["Events"] },
    },
    "/events/{eventId}": {
      get: { ...readOperation("Get an event", "EventDetail", [eventId]), tags: ["Events"] },
    },
    "/events/{eventId}/tracks": {
      get: { ...readOperation("List tracks", "Track", [eventId, ...pagination], true), tags: ["Events"] },
    },
    "/events/{eventId}/rooms": {
      get: { ...readOperation("List rooms", "Room", [eventId, ...pagination], true), tags: ["Events"] },
    },
    "/events/{eventId}/tasks": {
      get: { ...readOperation("List onboarding tasks", "Task", [eventId, ...pagination], true), tags: ["Events"] },
    },
    "/events/{eventId}/sessions": {
      get: {
        ...readOperation("List sessions", "SessionList", [
          eventId,
          ...pagination,
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["draft", "confirmed", "cancelled"] } },
          { name: "contentStatus", in: "query", schema: { type: "string", enum: ["draft", "in_review", "approved"] } },
          { name: "track", in: "query", schema: { type: "string" } },
          { name: "room", in: "query", schema: { type: "string" } },
          { name: "scheduled", in: "query", schema: { type: "boolean" } },
        ], true),
        tags: ["Sessions"],
      },
      ...writeOperation("Create a direct session", [eventId], "CreateSessionInput", "SessionDetail"),
    },
    "/events/{eventId}/sessions/{sessionId}": {
      get: {
        ...readOperation("Get a session", "SessionDetail", [eventId, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }]),
        tags: ["Sessions"],
      },
      ...writeOperation("Update a session", [eventId, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }], "UpdateSessionInput", "SessionDetail", "patch"),
    },
    "/events/{eventId}/sessions/{sessionId}/speakers": {
      ...writeOperation("Replace session speakers", [eventId, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }], "SetSessionSpeakersInput", "SessionDetail", "put"),
    },
    "/events/{eventId}/sessions/{sessionId}/placement": {
      ...writeOperation("Place a session", [eventId, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }], "PlaceSessionInput", "PlacementResult", "put"),
      delete: {
        summary: "Unschedule a session",
        security: [{ ApiKey: ["greenroom:write"] }, { OAuth2: ["greenroom:write"] }],
        parameters: [eventId, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": success("SessionDetail"), ...standardErrors },
      },
    },
    "/events/{eventId}/sessions/{sessionId}/suggested-slot": {
      get: {
        ...readOperation("Suggest the earliest conflict-free slot", "SlotSuggestionResult", [eventId, { name: "sessionId", in: "path", required: true, schema: { type: "string" } }]),
        tags: ["Sessions"],
      },
    },
    "/events/{eventId}/speakers": {
      get: {
        ...readOperation("List speakers", "SpeakerList", [
          eventId,
          ...pagination,
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "confirmation", in: "query", schema: { type: "string", enum: ["unconfirmed", "confirmed", "declined"] } },
        ], true),
        tags: ["Speakers"],
      },
      ...writeOperation("Add a speaker", [eventId], "CreateSpeakerInput", "SpeakerDetail"),
    },
    "/events/{eventId}/speakers/{speakerId}": {
      get: {
        ...readOperation("Get a speaker", "SpeakerDetail", [eventId, { name: "speakerId", in: "path", required: true, schema: { type: "string" } }]),
        tags: ["Speakers"],
      },
      ...writeOperation("Update a speaker", [eventId, { name: "speakerId", in: "path", required: true, schema: { type: "string" } }], "UpdateSpeakerInput", "SpeakerDetail", "patch"),
    },
    "/events/{eventId}/speakers/{speakerId}/confirmation": {
      ...writeOperation("Set speaker confirmation", [eventId, { name: "speakerId", in: "path", required: true, schema: { type: "string" } }], "SetSpeakerConfirmationInput", "SpeakerDetail", "put"),
    },
    "/events/{eventId}/submissions": {
      get: {
        ...readOperation("List submissions", "SubmissionList", [
          eventId,
          ...pagination,
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["draft", "submitted", "approved", "maybe", "denied", "withdrawn"] } },
          { name: "form", in: "query", schema: { type: "string" } },
          { name: "track", in: "query", schema: { type: "string" } },
        ], true),
        tags: ["Submissions"],
      },
    },
    "/events/{eventId}/submissions/{submissionId}": {
      get: {
        ...readOperation("Get a submission", "SubmissionDetail", [eventId, { name: "submissionId", in: "path", required: true, schema: { type: "string" } }]),
        tags: ["Submissions"],
      },
    },
    "/events/{eventId}/submissions/{submissionId}/decision": {
      ...writeOperation("Decide a submission", [eventId, { name: "submissionId", in: "path", required: true, schema: { type: "string" } }], "DecideSubmissionInput", "DecisionResult", "post", "200"),
    },
  },
  components: {
    securitySchemes: {
      ApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Greenroom API key (gr_…)",
        description: "An API key created on the API & MCP admin page.",
      },
      OAuth2: {
        type: "oauth2",
        flows: {
          authorizationCode: {
            authorizationUrl: "/api/auth/oauth2/authorize",
            tokenUrl: "/api/auth/oauth2/token",
            scopes: {
              "greenroom:read": "Read accessible event data",
              "greenroom:write": "Read and change accessible event data",
            },
          },
        },
      },
    },
    schemas: {
      NamedReference: {
        type: "object",
        required: ["id", "name"],
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
      SpeakerSummary: {
        type: "object",
        required: ["id", "name", "title", "company", "headshotUrl"],
        properties: {
          id: { type: "string" },
          name: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          company: { type: ["string", "null"] },
          headshotUrl: { type: ["string", "null"] },
        },
      },
      EventList: {
        type: "object",
        required: ["id", "name", "slug", "startDate", "endDate", "timezone", "location", "programPublished", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" }, name: { type: "string" }, slug: { type: "string" },
          startDate: { type: ["string", "null"], format: "date" },
          endDate: { type: ["string", "null"], format: "date" },
          timezone: { type: "string", examples: ["America/Los_Angeles"] },
          location: { type: ["string", "null"] }, programPublished: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      EventDetail: {
        allOf: [ref("EventList"), { type: "object", required: ["description"], properties: { description: { type: ["string", "null"] } } }],
      },
      Track: {
        type: "object", required: ["id", "eventId", "name", "color", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" }, eventId: { type: "string" }, name: { type: "string" }, color: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      Room: {
        type: "object", required: ["id", "eventId", "name", "capacity", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" }, eventId: { type: "string" }, name: { type: "string" }, capacity: { type: ["integer", "null"] },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      Task: {
        type: "object", required: ["id", "eventId", "title", "instructions", "type", "formId", "dueAt", "autoAssignOnAccept", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" }, eventId: { type: "string" }, title: { type: "string" }, instructions: { type: ["string", "null"] },
          type: { type: "string", enum: ["form", "file_request", "confirm"] }, formId: { type: ["string", "null"] },
          dueAt: { type: ["string", "null"], format: "date-time" }, autoAssignOnAccept: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      SpeakerList: {
        allOf: [ref("SpeakerSummary"), {
          type: "object", required: ["confirmationStatus", "confirmationSource", "createdAt", "updatedAt"],
          properties: {
            confirmationStatus: { type: "string", enum: ["unconfirmed", "confirmed", "declined"] },
            confirmationSource: { type: "string", enum: ["automatic", "override"] },
            createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
          },
        }],
      },
      SpeakerDetail: {
        allOf: [ref("SpeakerList"), {
          type: "object", required: ["email", "bio", "websiteUrl", "linkedinUrl", "twitterUrl", "notes", "sessions"],
          properties: {
            email: { type: "string", format: "email" }, bio: { type: ["string", "null"] }, websiteUrl: { type: ["string", "null"] },
            linkedinUrl: { type: ["string", "null"] }, twitterUrl: { type: ["string", "null"] }, notes: { type: ["string", "null"] },
            sessions: { type: "array", items: {
              type: "object", required: ["id", "title", "status", "schedulingStatus"],
              properties: { id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["draft", "confirmed", "cancelled"] }, schedulingStatus: { type: "string", enum: ["scheduled", "unscheduled"] } },
            } },
          },
        }],
      },
      SessionList: {
        type: "object",
        required: ["id", "eventId", "title", "status", "contentStatus", "schedulingStatus", "track", "room", "day", "startTime", "endTime", "speakers", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" }, eventId: { type: "string" }, title: { type: "string" },
          status: { type: "string", enum: ["draft", "confirmed", "cancelled"] }, contentStatus: { type: "string", enum: ["draft", "in_review", "approved"] },
          schedulingStatus: { type: "string", enum: ["scheduled", "unscheduled"] }, track: { oneOf: [ref("NamedReference"), { type: "null" }] }, room: { oneOf: [ref("NamedReference"), { type: "null" }] },
          day: { type: ["string", "null"], format: "date" }, startTime: { type: ["string", "null"], pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, endTime: { type: ["string", "null"], pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
          speakers: { type: "array", items: ref("SpeakerSummary") }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      SessionDetail: {
        allOf: [ref("SessionList"), {
          type: "object", required: ["description", "submissionId"],
          properties: { description: { type: ["string", "null"] }, submissionId: { type: ["string", "null"] }, speakers: { type: "array", items: { allOf: [ref("SpeakerSummary"), { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } }] } } },
        }],
      },
      SubmissionList: {
        type: "object", required: ["id", "eventId", "formId", "title", "status", "tracks", "speakers", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string" }, eventId: { type: "string" }, formId: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["draft", "submitted", "approved", "maybe", "denied", "withdrawn"] },
          tracks: { type: "array", items: ref("NamedReference") }, speakers: { type: "array", items: { allOf: [ref("SpeakerSummary"), { type: "object", required: ["role"], properties: { role: { type: "string", enum: ["primary", "co"] } } }] } },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        },
      },
      SubmissionDetail: {
        allOf: [ref("SubmissionList"), {
          type: "object", required: ["description", "answers", "form", "sessionId", "decision"],
          properties: {
            description: { type: ["string", "null"] }, answers: { type: "object", additionalProperties: true }, form: { oneOf: [ref("NamedReference"), { type: "null" }] }, sessionId: { type: ["string", "null"] },
            speakers: { type: "array", items: { allOf: [ref("SpeakerSummary"), { type: "object", required: ["email", "role"], properties: { email: { type: "string", format: "email" }, role: { type: "string", enum: ["primary", "co"] } } }] } },
            decision: { type: "object", required: ["decidedBy", "decidedAt", "note"], properties: { decidedBy: { type: ["string", "null"] }, decidedAt: { type: ["string", "null"], format: "date-time" }, note: { type: ["string", "null"] } } },
          },
        }],
      },
      CreateSessionInput: {
        type: "object", required: ["title"], additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1 }, description: { type: ["string", "null"] }, trackId: { type: ["string", "null"] }, speakerIds: { type: "array", items: { type: "string" }, default: [] },
          newSpeakers: { type: "array", default: [], items: { type: "object", required: ["name", "email"], additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, email: { type: "string", format: "email" } } } },
        },
      },
      UpdateSessionInput: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { title: { type: "string", minLength: 1 }, description: { type: ["string", "null"] }, trackId: { type: ["string", "null"] }, contentStatus: { type: "string", enum: ["draft", "in_review", "approved"] } },
      },
      SetSessionSpeakersInput: {
        type: "object", required: ["speakerIds"], additionalProperties: false, properties: { speakerIds: { type: "array", items: { type: "string" }, uniqueItems: true } },
      },
      PlaceSessionInput: {
        type: "object", required: ["day", "startTime", "endTime", "roomId"], additionalProperties: false,
        properties: { day: { type: "string", format: "date" }, startTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, endTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, roomId: { type: ["string", "null"] } },
      },
      PlacementResult: {
        type: "object", required: ["session", "conflicts"], properties: { session: ref("SessionDetail"), conflicts: { type: "array", items: { type: "object", required: ["type", "sessionIds", "message", "severity"], properties: { type: { type: "string", enum: ["speaker_double_booked", "room_double_booked", "track_overlap"] }, sessionIds: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } }, message: { type: "string" }, severity: { type: "string", enum: ["blocking", "advisory"] } } } } },
      },
      SlotSuggestionResult: {
        type: "object", required: ["suggestion", "timezone"], properties: { timezone: { type: "string" }, suggestion: { oneOf: [{ type: "null" }, { type: "object", required: ["day", "startTime", "endTime", "roomId"], properties: { day: { type: "string", format: "date" }, startTime: { type: "string" }, endTime: { type: "string" }, roomId: { type: ["string", "null"] } } }] } },
      },
      CreateSpeakerInput: {
        type: "object", required: ["name", "email"], additionalProperties: false,
        properties: { name: { type: "string", minLength: 1, maxLength: 120 }, email: { type: "string", format: "email" }, title: { type: ["string", "null"], maxLength: 120 }, company: { type: ["string", "null"], maxLength: 120 }, bio: { type: ["string", "null"], maxLength: 2000 } },
      },
      UpdateSpeakerInput: {
        type: "object", minProperties: 1, additionalProperties: false,
        properties: { name: { type: "string", minLength: 1, maxLength: 120 }, title: { type: ["string", "null"], maxLength: 120 }, company: { type: ["string", "null"], maxLength: 120 }, bio: { type: ["string", "null"], maxLength: 2000 }, notes: { type: ["string", "null"], maxLength: 4000 } },
      },
      SetSpeakerConfirmationInput: {
        type: "object", required: ["confirmation"], additionalProperties: false, properties: { confirmation: { type: ["string", "null"], enum: ["confirmed", "declined", null] } },
      },
      DecideSubmissionInput: {
        type: "object", required: ["decision"], additionalProperties: false,
        properties: { decision: { type: "string", enum: ["approved", "maybe", "denied"] }, note: { type: ["string", "null"], maxLength: 4000 }, notify: { type: "boolean", description: "Defaults on for approved/denied and off for maybe." } },
      },
      DecisionResult: {
        type: "object", required: ["submission", "sessionId", "sessionCreated", "assignmentsCreated", "assignmentsRemoved", "notified"], additionalProperties: false,
        properties: { submission: ref("SubmissionDetail"), sessionId: { type: ["string", "null"] }, sessionCreated: { type: "boolean" }, assignmentsCreated: { type: "integer", minimum: 0 }, assignmentsRemoved: { type: "integer", minimum: 0 }, notified: { type: "boolean" } },
      },
      Pagination: {
        type: "object",
        required: ["page", "pageSize", "total", "totalPages"],
        properties: {
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string", enum: ["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "rate_limited", "internal_error"] },
              message: { type: "string" },
              details: {},
              requestId: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
