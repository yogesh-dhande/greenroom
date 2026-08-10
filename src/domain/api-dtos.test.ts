import { describe, expect, it } from "vitest";

import type {
  Event,
  EventSpeaker,
  Form,
  Room,
  Session,
  Submission,
  Task,
  Track,
  User,
} from "@/db/entities";
import {
  API_ERROR_STATUS,
  apiDataResponseSchema,
  apiErrorResponseSchema,
  apiEventDetailSchema,
  apiPaginatedResponseSchema,
  apiSessionDetailSchema,
  apiSpeakerDetailSchema,
  apiSubmissionDetailSchema,
  deriveApiConfirmation,
  deriveSchedulingStatus,
  toApiErrorResponse,
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
} from "@/domain/api-dtos";

const createdAt = new Date("2026-05-01T12:30:00.000Z");
const updatedAt = new Date("2026-05-02T09:15:10.000Z");

const event: Event = {
  id: "event-1",
  name: "AI Engineer",
  slug: "ai-engineer",
  description: "A practical conference.",
  startDate: "2026-08-12",
  endDate: "2026-08-14",
  timezone: "America/Los_Angeles",
  location: "San Francisco",
  programPublished: true,
  createdAt,
  updatedAt,
};

const track: Track = {
  id: "track-1",
  eventId: event.id,
  name: "Agents",
  color: "#123456",
  createdAt,
  updatedAt,
};

const room: Room = {
  id: "room-1",
  eventId: event.id,
  name: "Main Stage",
  capacity: 500,
  createdAt,
  updatedAt,
};

const speaker: User = {
  id: "speaker-1",
  email: "ada@example.com",
  emailVerified: true,
  name: "Ada Lovelace",
  role: "admin",
  title: "Engineer",
  company: "Analytical Engines",
  bio: "Builds engines.",
  headshotUrl: "https://cdn.example.com/ada.jpg",
  websiteUrl: "https://ada.example.com",
  linkedinUrl: null,
  twitterUrl: null,
  socials: { github: "ada" },
  image: "private-auth-avatar",
  createdAt,
  updatedAt,
};

const session: Session = {
  id: "session-1",
  eventId: event.id,
  title: "Computing Notes",
  description: "The first program.",
  submissionId: "submission-1",
  trackId: track.id,
  roomId: room.id,
  day: "2026-08-12",
  startTime: "09:00",
  endTime: "09:30",
  status: "confirmed",
  contentStatus: "in_review",
  createdAt,
  updatedAt,
};

const submission: Submission = {
  id: "submission-1",
  eventId: event.id,
  formId: "form-1",
  title: "Computing Notes",
  description: "A proposal.",
  answers: { audience: "Advanced", custom: ["one", "two"] },
  status: "approved",
  resumeToken: "resume-token-must-never-leave-the-server",
  decidedBy: "admin-1",
  decidedAt: new Date("2026-05-03T10:00:00.000Z"),
  decisionNote: "Strong fit.",
  createdAt,
  updatedAt,
};

const form: Form = {
  id: "form-1",
  eventId: event.id,
  name: "Main CFP",
  slug: "main-cfp",
  type: "abstract",
  welcomeCopy: null,
  fields: [],
  opensAt: null,
  closesAt: null,
  confirmationPageContent: null,
  confirmationEmailSubject: null,
  confirmationEmailBody: null,
  maxSubmissionsPerSpeaker: null,
  isPublished: true,
  createdAt,
  updatedAt,
};

const eventSpeaker: EventSpeaker = {
  eventId: event.id,
  userId: speaker.id,
  notes: "Vegetarian dinner; arrives Tuesday.",
  confirmationStatus: null,
  createdAt,
  updatedAt,
};

describe("API DTO mappers", () => {
  it("keeps event-local days and wall-clock times while serializing instants as ISO-8601", () => {
    const eventDto = toApiEventDetail(event);
    const sessionDto = toApiSessionList(session, { speakers: [speaker], track, room });

    expect(eventDto).toMatchObject({
      startDate: "2026-08-12",
      endDate: "2026-08-14",
      timezone: "America/Los_Angeles",
      createdAt: "2026-05-01T12:30:00.000Z",
    });
    expect(sessionDto).toMatchObject({
      day: "2026-08-12",
      startTime: "09:00",
      endTime: "09:30",
      schedulingStatus: "scheduled",
      contentStatus: "in_review",
    });
    expect(apiEventDetailSchema.parse(eventDto)).toEqual(eventDto);
  });

  it("uses compact list records and richer detail records", () => {
    const eventList = toApiEventList(event);
    const sessionList = toApiSessionList(session, { speakers: [speaker], track, room });
    const sessionDetail = toApiSessionDetail(session, { speakers: [speaker], track, room });

    expect(eventList).not.toHaveProperty("description");
    expect(sessionList).not.toHaveProperty("description");
    expect(sessionList.speakers[0]).not.toHaveProperty("email");
    expect(sessionDetail).toMatchObject({
      description: "The first program.",
      submissionId: "submission-1",
      speakers: [{ id: speaker.id, email: "ada@example.com" }],
      track: { id: track.id, name: track.name },
      room: { id: room.id, name: room.name },
    });
    expect(apiSessionDetailSchema.parse(sessionDetail)).toEqual(sessionDetail);
  });

  it("redacts auth fields and includes organizer notes only on speaker detail", () => {
    const list = toApiSpeakerList(speaker, { eventSpeaker, sessionIds: [session.id] });
    const detail = toApiSpeakerDetail(speaker, { eventSpeaker, sessions: [session] });

    for (const dto of [list, detail]) {
      expect(dto).not.toHaveProperty("role");
      expect(dto).not.toHaveProperty("emailVerified");
      expect(dto).not.toHaveProperty("image");
      expect(dto).not.toHaveProperty("socials");
    }
    expect(list).not.toHaveProperty("email");
    expect(list).not.toHaveProperty("notes");
    expect(detail).toMatchObject({
      email: "ada@example.com",
      notes: "Vegetarian dinner; arrives Tuesday.",
      confirmationStatus: "confirmed",
      confirmationSource: "automatic",
      sessions: [{ id: session.id, schedulingStatus: "scheduled" }],
    });
    expect(apiSpeakerDetailSchema.parse(detail)).toEqual(detail);
  });

  it("never exposes a submission resume token and reserves answers for detail", () => {
    const context = {
      tracks: [track],
      speakers: [{ user: speaker, role: "primary" as const }],
      form,
      sessionId: session.id,
    };
    const list = toApiSubmissionList(submission, context);
    const detail = toApiSubmissionDetail(submission, context);

    expect(list).not.toHaveProperty("answers");
    expect(list).not.toHaveProperty("resumeToken");
    expect(list.speakers[0]).not.toHaveProperty("email");
    expect(detail).not.toHaveProperty("resumeToken");
    expect(JSON.stringify(detail)).not.toContain("resume-token-must-never-leave-the-server");
    expect(detail).toMatchObject({
      answers: submission.answers,
      form: { id: form.id, name: form.name },
      sessionId: session.id,
      speakers: [{ id: speaker.id, role: "primary", email: speaker.email }],
      decision: {
        decidedBy: "admin-1",
        decidedAt: "2026-05-03T10:00:00.000Z",
        note: "Strong fit.",
      },
    });
    expect(apiSubmissionDetailSchema.parse(detail)).toEqual(detail);

    // Strict schemas keep a future caller from spreading a database entity
    // into a response and silently adding a new secret field.
    expect(
      apiSubmissionDetailSchema.safeParse({ ...detail, resumeToken: submission.resumeToken })
        .success,
    ).toBe(false);
  });

  it("maps every event configuration record without returning entity Date objects", () => {
    const task: Task = {
      id: "task-1",
      eventId: event.id,
      title: "Upload slides",
      instructions: "PDF preferred",
      type: "file_request",
      formId: null,
      dueAt: new Date("2026-08-01T17:00:00.000Z"),
      autoAssignOnAccept: true,
      createdAt,
      updatedAt,
    };
    const records = [toApiTrack(track), toApiRoom(room), toApiTask(task)];

    expect(records).toMatchObject([
      { id: track.id, updatedAt: updatedAt.toISOString() },
      { id: room.id, updatedAt: updatedAt.toISOString() },
      { id: task.id, dueAt: "2026-08-01T17:00:00.000Z" },
    ]);
    expect(records.flatMap((record) => Object.values(record)).some((value) => value instanceof Date)).toBe(
      false,
    );
  });
});

describe("derived public statuses", () => {
  it("requires a complete placement before a session is scheduled", () => {
    expect(deriveSchedulingStatus(session)).toBe("scheduled");
    const withoutRoom = { ...session, roomId: null };
    expect(deriveSchedulingStatus(withoutRoom)).toBe("scheduled");
    expect(deriveSchedulingStatus({ ...session, endTime: null })).toBe("unscheduled");
  });

  it("lets stored confirmation win over session attachment", () => {
    expect(deriveApiConfirmation(null, false)).toEqual({
      status: "unconfirmed",
      source: "automatic",
    });
    expect(deriveApiConfirmation(null, true)).toEqual({
      status: "confirmed",
      source: "automatic",
    });
    expect(deriveApiConfirmation("declined", true)).toEqual({
      status: "declined",
      source: "override",
    });
    expect(deriveApiConfirmation("confirmed", false)).toEqual({
      status: "confirmed",
      source: "override",
    });
  });
});

describe("API response contracts", () => {
  it("defines the status for every stable error code", () => {
    expect(API_ERROR_STATUS).toEqual({
      bad_request: 400,
      unauthorized: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      rate_limited: 429,
      internal_error: 500,
    });
    const response = toApiErrorResponse(
      "conflict",
      "The session overlaps another session.",
      "request-1",
      { conflicts: ["session-2"] },
    );
    expect(apiErrorResponseSchema.parse(response)).toEqual(response);
  });

  it("validates data-only and paginated response envelopes", () => {
    const dataSchema = apiDataResponseSchema(apiEventDetailSchema);
    expect(dataSchema.parse({ data: toApiEventDetail(event) })).toBeTruthy();

    const paginatedSchema = apiPaginatedResponseSchema(apiEventDetailSchema);
    expect(
      paginatedSchema.parse({
        data: [toApiEventDetail(event)],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      }),
    ).toBeTruthy();
  });
});
