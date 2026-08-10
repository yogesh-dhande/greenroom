import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventSpeaker, Form, Session, Submission, User } from "@/db/entities";
import type { Repos } from "@/db/repos";
import { AdminWorkflowError } from "@/domain/admin-api";
import {
  authenticateExternalRequest,
  ExternalAuthError,
  requireExternalScope,
} from "@/lib/external-auth";
import { getRepos } from "@/lib/db";
import {
  createSession,
  createSpeaker,
  decideSubmission,
  placeSession,
  setSessionSpeakers,
  setSpeakerConfirmation,
  unscheduleSession,
  updateSession,
  updateSpeaker,
} from "@/domain/admin-api";
import { POST as postSession } from "./events/[eventId]/sessions/route";
import { PATCH as patchSession } from "./events/[eventId]/sessions/[sessionId]/route";
import { PUT as putSessionSpeakers } from "./events/[eventId]/sessions/[sessionId]/speakers/route";
import {
  DELETE as deletePlacement,
  PUT as putPlacement,
} from "./events/[eventId]/sessions/[sessionId]/placement/route";
import { POST as postSpeaker } from "./events/[eventId]/speakers/route";
import { PATCH as patchSpeaker } from "./events/[eventId]/speakers/[speakerId]/route";
import { PUT as putConfirmation } from "./events/[eventId]/speakers/[speakerId]/confirmation/route";
import { POST as postDecision } from "./events/[eventId]/submissions/[submissionId]/decision/route";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRepos: vi.fn() }));
vi.mock("@/lib/comms-context", () => ({ getCommsContext: vi.fn(async (value) => value) }));
vi.mock("@/lib/external-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/external-auth")>();
  return {
    ...actual,
    authenticateExternalRequest: vi.fn(),
    requireExternalScope: vi.fn(),
  };
});
vi.mock("@/domain/admin-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/admin-api")>();
  return {
    ...actual,
    createSession: vi.fn(),
    createSpeaker: vi.fn(),
    decideSubmission: vi.fn(),
    placeSession: vi.fn(),
    setSessionSpeakers: vi.fn(),
    setSpeakerConfirmation: vi.fn(),
    unscheduleSession: vi.fn(),
    updateSession: vi.fn(),
    updateSpeaker: vi.fn(),
  };
});

const EPOCH = new Date(0);
const event: Event = {
  id: "evt-1",
  name: "AI Engineer",
  slug: "aie",
  description: null,
  startDate: "2026-05-12",
  endDate: "2026-05-13",
  timezone: "America/Los_Angeles",
  location: null,
  programPublished: false,
  createdAt: EPOCH,
  updatedAt: EPOCH,
};
const actor: User = {
  id: "admin-1",
  email: "organizer@example.com",
  emailVerified: true,
  name: "Organizer",
  role: "admin",
  title: null,
  company: null,
  bio: null,
  headshotUrl: null,
  websiteUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  socials: null,
  image: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
};
const speaker: User = { ...actor, id: "speaker-1", email: "speaker@example.com", role: "speaker", name: "Ada" };
const session: Session = {
  id: "session-1",
  eventId: event.id,
  title: "Reliable agents",
  description: "An abstract",
  submissionId: null,
  trackId: null,
  roomId: null,
  day: null,
  startTime: "09:00",
  endTime: "09:30",
  status: "confirmed",
  contentStatus: "approved",
  createdAt: EPOCH,
  updatedAt: EPOCH,
};
const submission: Submission = {
  id: "submission-1",
  eventId: event.id,
  formId: "form-1",
  title: "Reliable agents",
  description: "An abstract",
  answers: { audience: "advanced" },
  status: "approved",
  resumeToken: "must-not-leak",
  decidedBy: actor.id,
  decidedAt: EPOCH,
  decisionNote: null,
  createdAt: EPOCH,
  updatedAt: EPOCH,
};
const form = {
  id: "form-1",
  eventId: event.id,
  name: "Main CFP",
} as Form;

let repos: Repos;

beforeEach(() => {
  vi.clearAllMocks();
  const membership = {
    eventId: event.id,
    userId: speaker.id,
    notes: null,
    confirmationStatus: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  } as EventSpeaker;
  repos = {
    events: { getById: vi.fn(async () => event) },
    users: {
      getById: vi.fn(async (id: string) => (id === actor.id ? actor : speaker)),
      listByIds: vi.fn(async (ids: string[]) => ids.map((id) => (id === actor.id ? actor : speaker))),
    },
    eventSpeakers: { get: vi.fn(async () => membership) },
    sessions: {
      getById: vi.fn(async () => session),
      getBySubmission: vi.fn(async () => session),
      listBySpeaker: vi.fn(async () => [session]),
      listSpeakersBySessionIds: vi.fn(async () => [
        { sessionId: session.id, userId: speaker.id },
      ]),
    },
    tracks: {
      getById: vi.fn(async () => null),
      listByIds: vi.fn(async () => []),
    },
    rooms: { getById: vi.fn(async () => null) },
    submissions: {
      getById: vi.fn(async () => submission),
      listTrackIds: vi.fn(async () => []),
      listSpeakers: vi.fn(async () => [
        { submissionId: submission.id, userId: speaker.id, role: "primary" as const },
      ]),
    },
    forms: { getById: vi.fn(async () => form) },
  } as unknown as Repos;
  vi.mocked(getRepos).mockResolvedValue(repos);
  vi.mocked(authenticateExternalRequest).mockResolvedValue({
    credentialId: "key-1",
    ownerId: actor.id,
    permission: "write",
    eventScope: "all",
    tokenType: "api_key",
  });
  vi.mocked(requireExternalScope).mockImplementation(() => undefined);
});

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`https://greenroom.test${path}`, {
    method,
    headers: { authorization: "Bearer gr_test", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("REST v1 session mutations", () => {
  it("creates a direct session with write auth and a 201 data envelope", async () => {
    vi.mocked(createSession).mockResolvedValue({ session, speakerIds: [speaker.id] });
    const input = { title: session.title, speakerIds: [speaker.id] };
    const response = await postSession(
      request(`/api/v1/events/${event.id}/sessions`, "POST", input),
      { params: Promise.resolve({ eventId: event.id }) },
    );

    expect(response.status).toBe(201);
    expect((await json(response)).data).toMatchObject({ id: session.id, title: session.title });
    expect(authenticateExternalRequest).toHaveBeenCalledWith(expect.any(Request), event.id);
    expect(requireExternalScope).toHaveBeenCalledWith(expect.anything(), "write", event.id);
    expect(createSession).toHaveBeenCalledWith({ repos }, event.id, input);
  });

  it("patches session content and replaces its complete speaker list", async () => {
    vi.mocked(updateSession).mockResolvedValue({ ...session, title: "New title" });
    vi.mocked(setSessionSpeakers).mockResolvedValue({ session, speakerIds: [speaker.id] });

    const patchResponse = await patchSession(
      request(`/api/v1/events/${event.id}/sessions/${session.id}`, "PATCH", { title: "New title" }),
      { params: Promise.resolve({ eventId: event.id, sessionId: session.id }) },
    );
    const speakersResponse = await putSessionSpeakers(
      request(`/api/v1/events/${event.id}/sessions/${session.id}/speakers`, "PUT", {
        speakerIds: [speaker.id],
      }),
      { params: Promise.resolve({ eventId: event.id, sessionId: session.id }) },
    );

    expect(patchResponse.status).toBe(200);
    expect(updateSession).toHaveBeenCalledWith(
      { repos }, event.id, session.id, actor.id, { title: "New title" },
    );
    expect(speakersResponse.status).toBe(200);
    expect(setSessionSpeakers).toHaveBeenCalledWith(
      { repos }, event.id, session.id, [speaker.id],
    );
  });

  it("reports placement conflicts without rejecting the write and supports unscheduling", async () => {
    const placed = { ...session, day: "2026-05-12", roomId: "room-1" };
    const conflicts = [{
      type: "speaker_double_booked" as const,
      sessionIds: [session.id, "session-2"] as [string, string],
      message: "Ada is double-booked",
      severity: "blocking" as const,
    }];
    vi.mocked(placeSession).mockResolvedValue({ session: placed, speakerIds: [speaker.id], conflicts });
    vi.mocked(unscheduleSession).mockResolvedValue(session);

    const placedResponse = await putPlacement(
      request(`/api/v1/events/${event.id}/sessions/${session.id}/placement`, "PUT", {
        day: "2026-05-12", startTime: "09:00", endTime: "09:30", roomId: "room-1",
      }),
      { params: Promise.resolve({ eventId: event.id, sessionId: session.id }) },
    );
    const unscheduledResponse = await deletePlacement(
      request(`/api/v1/events/${event.id}/sessions/${session.id}/placement`, "DELETE"),
      { params: Promise.resolve({ eventId: event.id, sessionId: session.id }) },
    );

    expect(placedResponse.status).toBe(200);
    expect((await json(placedResponse)).data).toMatchObject({ conflicts });
    expect(unscheduledResponse.status).toBe(200);
    expect(unscheduleSession).toHaveBeenCalledWith({ repos }, event.id, session.id);
  });
});

describe("REST v1 speaker mutations", () => {
  it("creates, patches, and confirms a speaker through the shared workflows", async () => {
    vi.mocked(createSpeaker).mockResolvedValue({ speaker, created: true, filled: [] });
    vi.mocked(updateSpeaker).mockResolvedValue({ ...speaker, company: "Analytical Engines" });
    vi.mocked(setSpeakerConfirmation).mockResolvedValue({
      eventId: event.id,
      userId: speaker.id,
      confirmationStatus: "confirmed",
      notes: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });

    const created = await postSpeaker(
      request(`/api/v1/events/${event.id}/speakers`, "POST", {
        name: speaker.name, email: speaker.email,
      }),
      { params: Promise.resolve({ eventId: event.id }) },
    );
    const patched = await patchSpeaker(
      request(`/api/v1/events/${event.id}/speakers/${speaker.id}`, "PATCH", {
        company: "Analytical Engines",
      }),
      { params: Promise.resolve({ eventId: event.id, speakerId: speaker.id }) },
    );
    const confirmed = await putConfirmation(
      request(`/api/v1/events/${event.id}/speakers/${speaker.id}/confirmation`, "PUT", {
        confirmation: "confirmed",
      }),
      { params: Promise.resolve({ eventId: event.id, speakerId: speaker.id }) },
    );

    expect(created.status).toBe(201);
    expect(patched.status).toBe(200);
    expect(confirmed.status).toBe(200);
    expect(createSpeaker).toHaveBeenCalledWith(
      { repos }, event.id, { name: speaker.name, email: speaker.email },
    );
    expect(updateSpeaker).toHaveBeenCalledWith(
      { repos }, event.id, speaker.id, { company: "Analytical Engines" },
    );
    expect(setSpeakerConfirmation).toHaveBeenCalledWith(
      { repos }, event.id, speaker.id, "confirmed",
    );
  });
});

describe("REST v1 submission decisions", () => {
  it("preserves an omitted notify value and exposes no delivery internals", async () => {
    vi.mocked(decideSubmission).mockResolvedValue({
      submission,
      sessionId: session.id,
      sessionCreated: true,
      assignmentsCreated: 2,
      assignmentsRemoved: 0,
      deliveries: [{
        to: "private@example.com",
        subject: "Your proposal was accepted",
        status: "sent",
        messageId: "mail-1",
      }],
    });
    const response = await postDecision(
      request(`/api/v1/events/${event.id}/submissions/${submission.id}/decision`, "POST", {
        decision: "approved",
      }),
      { params: Promise.resolve({ eventId: event.id, submissionId: submission.id }) },
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(decideSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ repos }), event.id, submission.id, actor.id, { decision: "approved" },
    );
    expect(body.data).toMatchObject({ notified: true, sessionId: session.id });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });
});

describe("REST v1 mutation errors", () => {
  it("maps workflow validation to a 400 public error envelope", async () => {
    vi.mocked(createSession).mockRejectedValue(
      new AdminWorkflowError("validation", "Title is required", { field: "title" }),
    );
    const response = await postSession(
      request(`/api/v1/events/${event.id}/sessions`, "POST", {}),
      { params: Promise.resolve({ eventId: event.id }) },
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: "bad_request", message: "Title is required" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns the canonical 403 envelope before invoking a service for read-only keys", async () => {
    vi.mocked(requireExternalScope).mockImplementation(() => {
      throw new ExternalAuthError(403, "insufficient_scope", "This credential does not allow writes.");
    });
    const response = await postSpeaker(
      request(`/api/v1/events/${event.id}/speakers`, "POST", {
        name: speaker.name, email: speaker.email,
      }),
      { params: Promise.resolve({ eventId: event.id }) },
    );

    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: "forbidden" });
    expect(createSpeaker).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown event before resolving a child resource", async () => {
    vi.mocked(repos.events.getById).mockResolvedValue(null);
    const response = await patchSession(
      request(`/api/v1/events/missing/sessions/${session.id}`, "PATCH", {
        title: "Should not be written",
      }),
      { params: Promise.resolve({ eventId: "missing", sessionId: session.id }) },
    );

    expect(response.status).toBe(404);
    expect((await json(response)).error).toMatchObject({ code: "not_found" });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("authenticates before returning 400 for malformed JSON", async () => {
    const bad = new Request(`https://greenroom.test/api/v1/events/${event.id}/sessions`, {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    });
    const response = await postSession(bad, {
      params: Promise.resolve({ eventId: event.id }),
    });

    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: "bad_request" });
    expect(authenticateExternalRequest).toHaveBeenCalledWith(bad, event.id);
  });
});
