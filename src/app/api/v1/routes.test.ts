import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-request";

const reads = vi.hoisted(() => ({
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  listTracks: vi.fn(),
  listRooms: vi.fn(),
  listTasks: vi.fn(),
  listSessions: vi.fn(),
  getSession: vi.fn(),
  suggestSessionSlot: vi.fn(),
  listSpeakers: vi.fn(),
  getSpeaker: vi.fn(),
  listSubmissions: vi.fn(),
  getSubmission: vi.fn(),
}));

vi.mock("@/app/api/v1/_lib/read", () => reads);

import { GET as getEvents } from "./events/route";
import { GET as getEvent } from "./events/[eventId]/route";
import { GET as getTracks } from "./events/[eventId]/tracks/route";
import { GET as getRooms } from "./events/[eventId]/rooms/route";
import { GET as getTasks } from "./events/[eventId]/tasks/route";
import { GET as getSessions } from "./events/[eventId]/sessions/route";
import { GET as getSession } from "./events/[eventId]/sessions/[sessionId]/route";
import { GET as getSuggestedSlot } from "./events/[eventId]/sessions/[sessionId]/suggested-slot/route";
import { GET as getSpeakers } from "./events/[eventId]/speakers/route";
import { GET as getSpeaker } from "./events/[eventId]/speakers/[speakerId]/route";
import { GET as getSubmissions } from "./events/[eventId]/submissions/route";
import { GET as getSubmission } from "./events/[eventId]/submissions/[submissionId]/route";

const times = { createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" };
const params = { params: Promise.resolve({ eventId: "event-1" }) };

interface CollectionBody {
  data: Array<{ id: string }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface ErrorBody {
  error: { code: string; message?: string; requestId: string };
}

function request(path: string) {
  return new Request(`https://greenroom.test${path}`);
}

describe("REST v1 read collections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.listEvents.mockResolvedValue([
      { id: "event-b", name: "Beta", slug: "beta", startDate: null, endDate: null, timezone: "UTC", location: null, programPublished: false, ...times },
      { id: "event-a", name: "Alpha", slug: "alpha", startDate: null, endDate: null, timezone: "UTC", location: null, programPublished: false, ...times },
    ]);
    reads.listTracks.mockResolvedValue([{ id: "track-1", eventId: "event-1", name: "AI", color: null, ...times }]);
    reads.listRooms.mockResolvedValue([{ id: "room-1", eventId: "event-1", name: "Main", capacity: 100, ...times }]);
    reads.listTasks.mockResolvedValue([{ id: "task-1", eventId: "event-1", title: "Bio", instructions: null, type: "confirm", formId: null, dueAt: null, autoAssignOnAccept: true, ...times }]);
    reads.listSessions.mockResolvedValue([
      { id: "session-1", eventId: "event-1", title: "Keynote", status: "confirmed", contentStatus: "approved", schedulingStatus: "scheduled", track: { id: "track-1", name: "AI" }, room: { id: "room-1", name: "Main" }, day: "2026-08-12", startTime: "09:00", endTime: "09:30", speakers: [], ...times },
      { id: "session-2", eventId: "event-1", title: "Draft talk", status: "draft", contentStatus: "draft", schedulingStatus: "unscheduled", track: null, room: null, day: null, startTime: null, endTime: null, speakers: [], ...times },
    ]);
    reads.listSpeakers.mockResolvedValue([
      { id: "speaker-1", name: "Ada", title: null, company: "Analytical", headshotUrl: null, confirmationStatus: "confirmed", confirmationSource: "automatic", ...times },
      { id: "speaker-2", name: "Grace", title: null, company: null, headshotUrl: null, confirmationStatus: "unconfirmed", confirmationSource: "automatic", ...times },
    ]);
    reads.listSubmissions.mockResolvedValue([
      { id: "submission-1", eventId: "event-1", formId: "form-1", title: "Proposal", status: "submitted", tracks: [{ id: "track-1", name: "AI" }], speakers: [], ...times },
      { id: "submission-2", eventId: "event-1", formId: "form-2", title: "Accepted", status: "approved", tracks: [], speakers: [], ...times },
    ]);
  });

  it("paginates and deterministically sorts events", async () => {
    const response = await getEvents(request("/api/v1/events?sort=title&direction=asc&pageSize=1"));
    const body = (await response.json()) as CollectionBody;

    expect(response.status).toBe(200);
    expect(body.data.map((event: { id: string }) => event.id)).toEqual(["event-a"]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });

  it.each([
    ["tracks", getTracks, "listTracks", "track-1"],
    ["rooms", getRooms, "listRooms", "room-1"],
    ["tasks", getTasks, "listTasks", "task-1"],
  ] as const)("wraps the %s collection", async (resource, handler, loader, id) => {
    const response = await handler(request(`/api/v1/events/event-1/${resource}`), params);
    const body = (await response.json()) as CollectionBody;

    expect(response.status).toBe(200);
    expect(body.data[0].id).toBe(id);
    expect(body.pagination.total).toBe(1);
    expect(reads[loader]).toHaveBeenCalledWith(expect.any(Request), "event-1");
  });

  it("applies session status, scheduled, track, and room filters", async () => {
    const response = await getSessions(
      request("/api/v1/events/event-1/sessions?status=confirmed&scheduled=true&track=track-1&room=room-1"),
      params,
    );
    const body = (await response.json()) as CollectionBody;
    expect(body.data.map((row: { id: string }) => row.id)).toEqual(["session-1"]);
  });

  it("applies speaker search and confirmation filters", async () => {
    const response = await getSpeakers(
      request("/api/v1/events/event-1/speakers?query=ada&confirmation=confirmed"),
      params,
    );
    expect(((await response.json()) as CollectionBody).data.map((row) => row.id)).toEqual(["speaker-1"]);
  });

  it("applies submission status, form, and track filters", async () => {
    const response = await getSubmissions(
      request("/api/v1/events/event-1/submissions?status=submitted&form=form-1&track=track-1"),
      params,
    );
    expect(((await response.json()) as CollectionBody).data.map((row) => row.id)).toEqual(["submission-1"]);
  });

  it("returns the standard 400 envelope for invalid and unknown query parameters", async () => {
    const response = await getSessions(
      request("/api/v1/events/event-1/sessions?pageSize=101&secret=leak"),
      params,
    );
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("bad_request");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(reads.listSessions).not.toHaveBeenCalled();
  });
});

describe("REST v1 read details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getEvent.mockResolvedValue({ id: "event-1", name: "Greenroom Live" });
    reads.getSession.mockResolvedValue({ id: "session-1", title: "Keynote" });
    reads.getSpeaker.mockResolvedValue({ id: "speaker-1", email: "ada@example.test" });
    reads.getSubmission.mockResolvedValue({ id: "submission-1", answers: { format: "talk" } });
    reads.suggestSessionSlot.mockResolvedValue({
      suggestion: {
        day: "2026-08-12",
        startTime: "09:00",
        endTime: "09:30",
        roomId: "room-1",
      },
      timezone: "America/Los_Angeles",
    });
  });

  it("wraps event, session, speaker, and submission details in {data}", async () => {
    const eventResponse = await getEvent(request("/api/v1/events/event-1"), {
      params: Promise.resolve({ eventId: "event-1" }),
    });
    const sessionResponse = await getSession(request("/api/v1/events/event-1/sessions/session-1"), {
      params: Promise.resolve({ eventId: "event-1", sessionId: "session-1" }),
    });
    const speakerResponse = await getSpeaker(request("/api/v1/events/event-1/speakers/speaker-1"), {
      params: Promise.resolve({ eventId: "event-1", speakerId: "speaker-1" }),
    });
    const submissionResponse = await getSubmission(
      request("/api/v1/events/event-1/submissions/submission-1"),
      { params: Promise.resolve({ eventId: "event-1", submissionId: "submission-1" }) },
    );

    await expect(eventResponse.json()).resolves.toEqual({
      data: { id: "event-1", name: "Greenroom Live" },
    });
    await expect(sessionResponse.json()).resolves.toEqual({
      data: { id: "session-1", title: "Keynote" },
    });
    await expect(speakerResponse.json()).resolves.toEqual({
      data: { id: "speaker-1", email: "ada@example.test" },
    });
    await expect(submissionResponse.json()).resolves.toEqual({
      data: { id: "submission-1", answers: { format: "talk" } },
    });
    expect(reads.getSession).toHaveBeenCalledWith(expect.any(Request), "event-1", "session-1");
    expect(reads.getSpeaker).toHaveBeenCalledWith(expect.any(Request), "event-1", "speaker-1");
    expect(reads.getSubmission).toHaveBeenCalledWith(
      expect.any(Request),
      "event-1",
      "submission-1",
    );
  });

  it("wraps the shared slot suggestion result and timezone", async () => {
    const response = await getSuggestedSlot(
      request("/api/v1/events/event-1/sessions/session-1/suggested-slot"),
      { params: Promise.resolve({ eventId: "event-1", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        suggestion: {
          day: "2026-08-12",
          startTime: "09:00",
          endTime: "09:30",
          roomId: "room-1",
        },
        timezone: "America/Los_Angeles",
      },
    });
    expect(reads.suggestSessionSlot).toHaveBeenCalledWith(
      expect.any(Request),
      "event-1",
      "session-1",
    );
  });

  it("returns the standard 404 envelope from a missing event-scoped detail", async () => {
    reads.getSession.mockRejectedValueOnce(new ApiError(404, "not_found", "Session not found."));

    const response = await getSession(request("/api/v1/events/event-1/sessions/missing"), {
      params: Promise.resolve({ eventId: "event-1", sessionId: "missing" }),
    });
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({ code: "not_found", message: "Session not found." });
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
