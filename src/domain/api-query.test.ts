import { describe, expect, it } from "vitest";

import type {
  ApiSessionList,
  ApiSpeakerList,
  ApiSubmissionList,
} from "@/domain/api-dtos";
import {
  applySessionCollectionQuery,
  applySpeakerCollectionQuery,
  applySubmissionCollectionQuery,
  collectionQuerySchema,
  paginateCollection,
  parseCollectionQuery,
  sessionCollectionQuerySchema,
  sortCollection,
  speakerCollectionQuerySchema,
  submissionCollectionQuerySchema,
} from "@/domain/api-query";

const speakerAda = {
  id: "speaker-ada",
  name: "Ada Lovelace",
  title: "Engineer",
  company: "Analytical Engines",
  headshotUrl: null,
} as const;

const speakerGrace = {
  id: "speaker-grace",
  name: "Grace Hopper",
  title: "Admiral",
  company: "Navy",
  headshotUrl: null,
} as const;

function session(
  patch: Partial<ApiSessionList> & Pick<ApiSessionList, "id" | "title">,
): ApiSessionList {
  return {
    eventId: "event-1",
    status: "confirmed",
    contentStatus: "approved",
    schedulingStatus: "unscheduled",
    track: null,
    room: null,
    day: null,
    startTime: null,
    endTime: null,
    speakers: [],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...patch,
  };
}

function speaker(
  patch: Partial<ApiSpeakerList> & Pick<ApiSpeakerList, "id" | "name">,
): ApiSpeakerList {
  return {
    title: null,
    company: null,
    headshotUrl: null,
    confirmationStatus: "unconfirmed",
    confirmationSource: "automatic",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...patch,
  };
}

function submission(
  patch: Partial<ApiSubmissionList> & Pick<ApiSubmissionList, "id" | "title">,
): ApiSubmissionList {
  return {
    eventId: "event-1",
    formId: "form-1",
    status: "submitted",
    tracks: [],
    speakers: [],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...patch,
  };
}

describe("collection query parsing", () => {
  it("applies pagination and sorting defaults", () => {
    expect(parseCollectionQuery(collectionQuerySchema, new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 25,
      sort: "updatedAt",
      direction: "desc",
    });
  });

  it("coerces query string values and trims search", () => {
    expect(
      parseCollectionQuery(
        sessionCollectionQuerySchema,
        new URLSearchParams({
          page: "2",
          pageSize: "100",
          query: "  agents  ",
          scheduled: "false",
          status: "draft",
          contentStatus: "in_review",
          sort: "title",
          direction: "asc",
        }),
      ),
    ).toEqual({
      page: 2,
      pageSize: 100,
      query: "agents",
      scheduled: false,
      status: "draft",
      contentStatus: "in_review",
      sort: "title",
      direction: "asc",
    });
  });

  it("rejects oversized pages, invalid booleans, unsupported sorting and unknown keys", () => {
    expect(() =>
      parseCollectionQuery(collectionQuerySchema, { pageSize: "101" }),
    ).toThrow();
    expect(() =>
      parseCollectionQuery(sessionCollectionQuerySchema, { scheduled: "sometimes" }),
    ).toThrow();
    expect(() => parseCollectionQuery(collectionQuerySchema, { sort: "email" })).toThrow();
    expect(() => parseCollectionQuery(collectionQuerySchema, { secret: "value" })).toThrow();
  });
});

describe("sorting and pagination", () => {
  const records = [
    session({ id: "b", title: "Beta", updatedAt: "2026-05-02T00:00:00.000Z" }),
    session({ id: "a", title: "alpha", updatedAt: "2026-05-02T00:00:00.000Z" }),
    session({ id: "c", title: "Gamma", updatedAt: "2026-05-03T00:00:00.000Z" }),
  ];

  it("defaults to updatedAt descending with id ascending as the stable tie-break", () => {
    expect(sortCollection(records).map((record) => record.id)).toEqual(["c", "a", "b"]);
  });

  it("supports case-insensitive title and createdAt sorting", () => {
    expect(sortCollection(records, "title", "asc").map((record) => record.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortCollection(records, "createdAt", "desc").map((record) => record.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns stable pagination metadata for full, out-of-range and empty pages", () => {
    expect(paginateCollection(records, 2, 2)).toEqual({
      data: [records[2]],
      pagination: { page: 2, pageSize: 2, total: 3, totalPages: 2 },
    });
    expect(paginateCollection(records, 3, 2)).toEqual({
      data: [],
      pagination: { page: 3, pageSize: 2, total: 3, totalPages: 2 },
    });
    expect(paginateCollection([], 1, 25)).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    });
  });
});

describe("session collection filtering", () => {
  const sessions = [
    session({
      id: "scheduled",
      title: "Agent architectures",
      track: { id: "track-agents", name: "Agents" },
      room: { id: "room-main", name: "Main" },
      schedulingStatus: "scheduled",
      day: "2026-08-12",
      startTime: "09:00",
      endTime: "09:30",
      speakers: [speakerAda],
      updatedAt: "2026-05-03T00:00:00.000Z",
    }),
    session({
      id: "draft",
      title: "Compilers",
      status: "draft",
      contentStatus: "in_review",
      track: { id: "track-systems", name: "Systems" },
      room: { id: "room-side", name: "Side" },
      speakers: [speakerGrace],
      updatedAt: "2026-05-02T00:00:00.000Z",
    }),
  ];

  it("composes query, state, relationship and scheduled filters", () => {
    const query = sessionCollectionQuerySchema.parse({
      query: "hopper",
      status: "draft",
      contentStatus: "in_review",
      track: "track-systems",
      room: "room-side",
      scheduled: false,
    });
    expect(applySessionCollectionQuery(sessions, query).data.map((item) => item.id)).toEqual([
      "draft",
    ]);
  });

  it("searches session titles and compact speaker fields", () => {
    const title = sessionCollectionQuerySchema.parse({ query: "ARCHITECT" });
    const company = sessionCollectionQuerySchema.parse({ query: "analytical" });
    expect(applySessionCollectionQuery(sessions, title).data[0].id).toBe("scheduled");
    expect(applySessionCollectionQuery(sessions, company).data[0].id).toBe("scheduled");
  });
});

describe("speaker collection filtering", () => {
  const speakers = [
    speaker({
      ...speakerAda,
      confirmationStatus: "confirmed",
      confirmationSource: "automatic",
    }),
    speaker({
      ...speakerGrace,
      confirmationStatus: "declined",
      confirmationSource: "override",
    }),
  ];

  it("filters by profile query and effective confirmation status", () => {
    const query = speakerCollectionQuerySchema.parse({ query: "navy", confirmation: "declined" });
    expect(applySpeakerCollectionQuery(speakers, query).data.map((item) => item.id)).toEqual([
      "speaker-grace",
    ]);
  });
});

describe("submission collection filtering", () => {
  const submissions = [
    submission({
      id: "one",
      title: "Agent architectures",
      status: "approved",
      formId: "form-main",
      tracks: [{ id: "track-agents", name: "Agents" }],
      speakers: [{ ...speakerAda, role: "primary" }],
    }),
    submission({
      id: "two",
      title: "Compiler design",
      status: "maybe",
      formId: "form-invited",
      tracks: [{ id: "track-systems", name: "Systems" }],
      speakers: [{ ...speakerGrace, role: "primary" }],
    }),
  ];

  it("composes query, status, form and track filters", () => {
    const query = submissionCollectionQuerySchema.parse({
      query: "grace",
      status: "maybe",
      form: "form-invited",
      track: "track-systems",
    });
    expect(applySubmissionCollectionQuery(submissions, query).data.map((item) => item.id)).toEqual([
      "two",
    ]);
  });
});
