import { describe, expect, it } from "vitest";
import {
  buildGallery,
  buildSchedule,
  gallerySessions,
  isPubliclyVisible,
  scheduleSessions,
  type ProgramPerson,
  type SessionWithSpeakers,
} from "@/domain/program";

/** A confirmed, scheduled session with sensible defaults, overridable per
 * test — mirrors the fixture builder in scheduling.test.ts. */
function session(overrides: Partial<SessionWithSpeakers> & { id: string }): SessionWithSpeakers {
  return {
    eventId: "evt-1",
    title: overrides.id,
    description: null,
    submissionId: null,
    trackId: null,
    roomId: null,
    day: "2026-06-16",
    startTime: "10:00",
    endTime: "10:30",
    status: "confirmed",
    speakerIds: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function person(overrides: Partial<ProgramPerson> & { id: string; name: string }): ProgramPerson {
  return {
    title: null,
    company: null,
    bio: null,
    headshotUrl: null,
    ...overrides,
  };
}

describe("isPubliclyVisible / gallerySessions / scheduleSessions", () => {
  it("only confirmed sessions are publicly visible", () => {
    expect(isPubliclyVisible({ status: "confirmed" })).toBe(true);
    expect(isPubliclyVisible({ status: "draft" })).toBe(false);
    expect(isPubliclyVisible({ status: "cancelled" })).toBe(false);
  });

  it("gallery keeps confirmed sessions whether or not they're scheduled", () => {
    const scheduled = session({ id: "a", status: "confirmed" });
    const unscheduled = session({ id: "b", status: "confirmed", day: null, startTime: null, endTime: null });
    const cancelled = session({ id: "c", status: "cancelled" });
    const draft = session({ id: "d", status: "draft" });

    expect(gallerySessions([scheduled, unscheduled, cancelled, draft])).toEqual([
      scheduled,
      unscheduled,
    ]);
  });

  it("schedule keeps only confirmed sessions that are actually placed", () => {
    const scheduled = session({ id: "a", status: "confirmed" });
    const unscheduled = session({ id: "b", status: "confirmed", day: null, startTime: null, endTime: null });
    const cancelled = session({
      id: "c",
      status: "cancelled",
      day: "2026-06-16",
      startTime: "11:00",
      endTime: "11:30",
    });
    const partiallyPlaced = session({ id: "d", status: "confirmed", startTime: null });

    expect(scheduleSessions([scheduled, unscheduled, cancelled, partiallyPlaced])).toEqual([
      scheduled,
    ]);
  });
});

describe("buildGallery", () => {
  it("dedups a speaker across multiple accepted talks onto one card", () => {
    const priya = person({ id: "u1", name: "Priya Raman" });
    const sessions = [
      session({ id: "s1", title: "Retrieval at scale", speakerIds: ["u1"] }),
      session({ id: "s2", title: "A second talk", speakerIds: ["u1"] }),
    ];

    const gallery = buildGallery(sessions, new Map([["u1", priya]]));

    expect(gallery).toHaveLength(1);
    expect(gallery[0].talks.map((t) => t.title)).toEqual(["Retrieval at scale", "A second talk"]);
  });

  it("excludes speakers whose only sessions are cancelled or unscheduled per scope, keeps unscheduled", () => {
    const hannah = person({ id: "u2", name: "Hannah Kim" });
    const cancelledSpeaker = person({ id: "u3", name: "Cancelled Speaker" });

    const sessions = [
      session({
        id: "s3",
        title: "Evals you'll actually keep running",
        speakerIds: ["u2"],
        day: null,
        startTime: null,
        endTime: null,
      }),
      session({
        id: "s4",
        title: "Stood down talk",
        speakerIds: ["u3"],
        status: "cancelled",
      }),
    ];

    const people = new Map([
      ["u2", hannah],
      ["u3", cancelledSpeaker],
    ]);
    const gallery = buildGallery(sessions, people);

    expect(gallery.map((g) => g.name)).toEqual(["Hannah Kim"]);
  });

  it("sorts speakers by name and skips ids missing from the people map", () => {
    const zed = person({ id: "u-z", name: "Zed Ng" });
    const sessions = [
      session({ id: "s5", title: "Talk Z", speakerIds: ["u-z"] }),
      session({ id: "s6", title: "Talk missing", speakerIds: ["u-ghost"] }),
      session({ id: "s7", title: "Talk A", speakerIds: ["u-a"] }),
    ];
    const anna = person({ id: "u-a", name: "Anna Alvarez" });

    const gallery = buildGallery(sessions, new Map([
      ["u-z", zed],
      ["u-a", anna],
    ]));

    expect(gallery.map((g) => g.name)).toEqual(["Anna Alvarez", "Zed Ng"]);
  });
});

describe("buildSchedule", () => {
  const lookups = {
    trackById: new Map([["t1", { name: "AI Engineering", color: "#0e7490" }]]),
    roomById: new Map([
      ["r1", { name: "Main Stage" }],
      ["r2", { name: "Workshop A" }],
    ]),
    speakerNameById: new Map([
      ["u1", "Priya Raman"],
      ["u2", "Tom Beckett"],
    ]),
  };

  it("groups sessions by day, in start-time order", () => {
    const sessions = [
      session({ id: "s2", day: "2026-06-16", startTime: "14:00", endTime: "14:45" }),
      session({ id: "s1", day: "2026-06-16", startTime: "10:00", endTime: "10:45" }),
      session({ id: "s3", day: "2026-06-17", startTime: "09:00", endTime: "09:30" }),
    ];

    const days = buildSchedule(sessions, lookups);

    expect(days.map((d) => d.day)).toEqual(["2026-06-16", "2026-06-17"]);
    expect(days[0].slots.map((slot) => slot.sessions[0].id)).toEqual(["s1", "s2"]);
  });

  it("groups sessions sharing the same day and time range into one slot", () => {
    const sessions = [
      session({
        id: "s1",
        title: "Main stage keynote",
        roomId: "r1",
        trackId: "t1",
        speakerIds: ["u1"],
        startTime: "10:00",
        endTime: "10:45",
      }),
      session({
        id: "s2",
        title: "Parallel workshop",
        roomId: "r2",
        speakerIds: ["u2"],
        startTime: "10:00",
        endTime: "10:45",
      }),
    ];

    const [day] = buildSchedule(sessions, lookups);

    expect(day.slots).toHaveLength(1);
    expect(day.slots[0].sessions).toHaveLength(2);
    // Room name ordering: Main Stage before Workshop A.
    expect(day.slots[0].sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(day.slots[0].sessions[0].trackName).toBe("AI Engineering");
    expect(day.slots[0].sessions[0].speakerNames).toEqual(["Priya Raman"]);
  });

  it("excludes cancelled and unscheduled sessions from the schedule", () => {
    const sessions = [
      session({ id: "s1" }),
      session({ id: "s2", status: "cancelled" }),
      session({ id: "s3", day: null, startTime: null, endTime: null }),
    ];

    const days = buildSchedule(sessions, lookups);
    const allIds = days.flatMap((d) => d.slots.flatMap((slot) => slot.sessions.map((s) => s.id)));
    expect(allIds).toEqual(["s1"]);
  });
});
