import { describe, expect, it } from "vitest";
import {
  buildAssignmentViews,
  buildSpeakerRollups,
  deriveTaskState,
  sortAssignmentViews,
  filterSpeakerRollups,
  matchesSpeakerSearch,
  rosterSpeakerIds,
  sortSpeakerRollups,
  speakerRosterStatus,
  type AssignmentView,
  type SpeakerRollup,
} from "@/domain/onboarding";
import type { Task, TaskAssignment, User } from "@/db/entities";

const NOW = new Date("2026-08-10T12:00:00Z");

/** A task with sensible defaults, overridable per test. */
function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    eventId: "evt-1",
    title: overrides.id,
    instructions: null,
    type: "confirm",
    formId: null,
    dueAt: null,
    autoAssignOnAccept: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** A task assignment with sensible defaults, overridable per test. */
function assignment(overrides: Partial<TaskAssignment> & { id: string; taskId: string }): TaskAssignment {
  return {
    speakerId: "user-1",
    status: "pending",
    completedAt: null,
    responseJson: null,
    fileUrl: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

/** A user with sensible defaults, overridable per test. */
function user(overrides: Partial<User> & { id: string }): User {
  return {
    email: `${overrides.id}@example.com`,
    emailVerified: true,
    name: overrides.id,
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
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("deriveTaskState", () => {
  it("is complete once the assignment is completed, regardless of due date", () => {
    const pastDue = new Date("2026-08-01T00:00:00Z");
    expect(deriveTaskState({ status: "completed" }, pastDue, NOW)).toBe("complete");
  });

  it("is open when there's no due date and the assignment is pending", () => {
    expect(deriveTaskState({ status: "pending" }, null, NOW)).toBe("open");
  });

  it("is overdue once the due date has passed", () => {
    const yesterday = new Date("2026-08-09T00:00:00Z");
    expect(deriveTaskState({ status: "pending" }, yesterday, NOW)).toBe("overdue");
  });

  it("is due_soon within the window but not yet overdue", () => {
    const inTwoDays = new Date("2026-08-12T12:00:00Z");
    expect(deriveTaskState({ status: "pending" }, inTwoDays, NOW)).toBe("due_soon");
  });

  it("is open when the due date is beyond the due-soon window", () => {
    const inTwoWeeks = new Date("2026-08-24T12:00:00Z");
    expect(deriveTaskState({ status: "pending" }, inTwoWeeks, NOW)).toBe("open");
  });

  it("treats the exact edge of the window as due_soon", () => {
    const exactlyThreeDays = new Date("2026-08-13T12:00:00Z");
    expect(deriveTaskState({ status: "pending" }, exactlyThreeDays, NOW)).toBe("due_soon");
  });
});

describe("buildAssignmentViews", () => {
  it("pairs assignments with their task and derived state", () => {
    const tasksById = new Map([["t1", task({ id: "t1", dueAt: new Date("2026-08-01T00:00:00Z") })]]);
    const views = buildAssignmentViews(
      [assignment({ id: "a1", taskId: "t1" })],
      tasksById,
      NOW,
    );
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe("overdue");
    expect(views[0].task.id).toBe("t1");
  });

  it("silently drops assignments whose task can't be resolved", () => {
    const views = buildAssignmentViews(
      [assignment({ id: "a1", taskId: "missing" })],
      new Map(),
      NOW,
    );
    expect(views).toEqual([]);
  });
});

describe("sortAssignmentViews", () => {
  function view(state: AssignmentView["state"], dueAt: Date | null, id: string): AssignmentView {
    return {
      assignment: assignment({ id, taskId: id, status: state === "complete" ? "completed" : "pending" }),
      task: task({ id, dueAt }),
      state,
    };
  }

  it("ranks overdue, then due_soon, then open, then complete", () => {
    const views = [
      view("complete", null, "done"),
      view("open", new Date("2026-09-01T00:00:00Z"), "open"),
      view("overdue", new Date("2026-08-01T00:00:00Z"), "late"),
      view("due_soon", new Date("2026-08-11T00:00:00Z"), "soon"),
    ];
    expect(sortAssignmentViews(views).map((v) => v.task.id)).toEqual([
      "late",
      "soon",
      "open",
      "done",
    ]);
  });

  it("breaks ties within a state by soonest due date, undated last", () => {
    const views = [
      view("open", null, "no-date"),
      view("open", new Date("2026-08-20T00:00:00Z"), "later"),
      view("open", new Date("2026-08-15T00:00:00Z"), "sooner"),
    ];
    expect(sortAssignmentViews(views).map((v) => v.task.id)).toEqual([
      "sooner",
      "later",
      "no-date",
    ]);
  });
});

describe("buildSpeakerRollups", () => {
  it("computes counts and a 100% completion for a speaker with no tasks", () => {
    const speaker = user({ id: "s1" });
    const rollups = buildSpeakerRollups({
      speakers: [speaker],
      confirmedSpeakerIds: new Set(["s1"]),
      assignmentsBySpeaker: new Map(),
      tasksById: new Map(),
      now: NOW,
    });
    expect(rollups).toHaveLength(1);
    expect(rollups[0].confirmed).toBe(true);
    expect(rollups[0].totalTasks).toBe(0);
    expect(rollups[0].completionPercent).toBe(100);
    expect(rollups[0].outstandingTasks).toBe(0);
    expect(rollups[0].overdueTasks).toBe(0);
  });

  it("counts outstanding/overdue tasks and computes a partial completion %", () => {
    const speaker = user({ id: "s1" });
    const tasksById = new Map([
      ["t1", task({ id: "t1", dueAt: new Date("2026-08-01T00:00:00Z") })], // overdue
      ["t2", task({ id: "t2", dueAt: null })], // open
      ["t3", task({ id: "t3", dueAt: null })], // completed
      ["t4", task({ id: "t4", dueAt: null })], // completed
    ]);
    const assignmentsBySpeaker = new Map([
      [
        "s1",
        [
          assignment({ id: "a1", taskId: "t1", speakerId: "s1", status: "pending" }),
          assignment({ id: "a2", taskId: "t2", speakerId: "s1", status: "pending" }),
          assignment({ id: "a3", taskId: "t3", speakerId: "s1", status: "completed", completedAt: NOW }),
          assignment({ id: "a4", taskId: "t4", speakerId: "s1", status: "completed", completedAt: NOW }),
        ],
      ],
    ]);

    const [rollup] = buildSpeakerRollups({
      speakers: [speaker],
      confirmedSpeakerIds: new Set(),
      assignmentsBySpeaker,
      tasksById,
      now: NOW,
    });

    expect(rollup.confirmed).toBe(false);
    expect(rollup.totalTasks).toBe(4);
    expect(rollup.completedTasks).toBe(2);
    expect(rollup.overdueTasks).toBe(1);
    expect(rollup.outstandingTasks).toBe(2);
    expect(rollup.completionPercent).toBe(50);
    // views come back pre-sorted, most urgent first
    expect(rollup.views.map((v) => v.task.id)).toEqual(["t1", "t2", "t3", "t4"]);
  });
});

describe("sortSpeakerRollups", () => {
  it("puts the most overdue speaker first", () => {
    const a = user({ id: "a", name: "Alice" });
    const b = user({ id: "b", name: "Bob" });
    const rollups = buildSpeakerRollups({
      speakers: [a, b],
      confirmedSpeakerIds: new Set(),
      assignmentsBySpeaker: new Map([
        [
          "a",
          [assignment({ id: "a1", taskId: "t1", speakerId: "a", status: "pending" })],
        ],
        [
          "b",
          [
            assignment({ id: "b1", taskId: "t1", speakerId: "b", status: "pending" }),
            assignment({ id: "b2", taskId: "t2", speakerId: "b", status: "pending" }),
          ],
        ],
      ]),
      tasksById: new Map([
        ["t1", task({ id: "t1", dueAt: new Date("2026-08-01T00:00:00Z") })],
        ["t2", task({ id: "t2", dueAt: new Date("2026-08-02T00:00:00Z") })],
      ]),
      now: NOW,
    });

    const sorted = sortSpeakerRollups(rollups);
    expect(sorted.map((r) => r.speaker.id)).toEqual(["b", "a"]);
  });

  it("falls back to lowest completion % and then name when overdue counts tie", () => {
    const alice = user({ id: "a", name: "Alice" });
    const zoe = user({ id: "z", name: "Zoe" });
    const rollups = buildSpeakerRollups({
      speakers: [zoe, alice],
      confirmedSpeakerIds: new Set(),
      assignmentsBySpeaker: new Map([
        ["z", [assignment({ id: "z1", taskId: "t1", speakerId: "z", status: "completed", completedAt: NOW })]],
        ["a", [assignment({ id: "a1", taskId: "t1", speakerId: "a", status: "pending" })]],
      ]),
      tasksById: new Map([["t1", task({ id: "t1", dueAt: null })]]),
      now: NOW,
    });

    const sorted = sortSpeakerRollups(rollups);
    // Alice: 0% complete sorts before Zoe's 100%, no overdue tasks in play.
    expect(sorted.map((r) => r.speaker.id)).toEqual(["a", "z"]);
  });
});

describe("rosterSpeakerIds", () => {
  it("unions the three membership sources without duplicates", () => {
    expect(
      rosterSpeakerIds({
        confirmedSpeakerIds: ["a", "b"],
        assignedSpeakerIds: ["b", "c"],
        memberSpeakerIds: ["c", "d"],
      }),
    ).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("keeps a hand-added speaker with no session and no task", () => {
    expect(
      rosterSpeakerIds({
        confirmedSpeakerIds: [],
        assignedSpeakerIds: [],
        memberSpeakerIds: ["added-by-hand"],
      }),
    ).toEqual(new Set(["added-by-hand"]));
  });
});

describe("roster filtering", () => {
  /** A rollup with only the fields the filters read. */
  function rollup(
    speakerOverrides: Partial<User> & { id: string },
    counts: { outstanding?: number; overdue?: number } = {},
  ): SpeakerRollup {
    const outstandingTasks = counts.outstanding ?? 0;
    return {
      speaker: user(speakerOverrides),
      confirmed: true,
      totalTasks: outstandingTasks,
      completedTasks: 0,
      outstandingTasks,
      overdueTasks: counts.overdue ?? 0,
      completionPercent: outstandingTasks === 0 ? 100 : 0,
      views: [],
    };
  }

  const ada = rollup({ id: "ada", name: "Ada Lovelace", company: "Analytical Engines" });
  const grace = rollup({ id: "grace", name: "Grace Hopper", company: "US Navy" }, { outstanding: 2 });
  const alan = rollup({ id: "alan", name: "Alan Turing", company: null }, { outstanding: 1, overdue: 1 });
  const all = [ada, grace, alan];

  it("derives one status per speaker, overdue taking precedence", () => {
    expect(speakerRosterStatus(ada)).toBe("complete");
    expect(speakerRosterStatus(grace)).toBe("incomplete");
    expect(speakerRosterStatus(alan)).toBe("overdue");
  });

  it("counts overdue speakers as outstanding too", () => {
    expect(filterSpeakerRollups(all, { q: "", status: "incomplete" }).map((r) => r.speaker.id)).toEqual([
      "grace",
      "alan",
    ]);
    expect(filterSpeakerRollups(all, { q: "", status: "overdue" }).map((r) => r.speaker.id)).toEqual([
      "alan",
    ]);
    expect(filterSpeakerRollups(all, { q: "", status: "complete" }).map((r) => r.speaker.id)).toEqual([
      "ada",
    ]);
  });

  it("searches name, email and company, case-insensitively", () => {
    expect(matchesSpeakerSearch(ada, "lovelace")).toBe(true);
    expect(matchesSpeakerSearch(ada, "ADA@")).toBe(true);
    expect(matchesSpeakerSearch(ada, "analytical")).toBe(true);
    expect(matchesSpeakerSearch(ada, "hopper")).toBe(false);
    // No company at all is a miss, never a crash.
    expect(matchesSpeakerSearch(alan, "navy")).toBe(false);
  });

  it("treats an empty or whitespace query as no filter", () => {
    expect(filterSpeakerRollups(all, { q: "  ", status: "all" })).toHaveLength(3);
  });

  it("combines search and status", () => {
    expect(
      filterSpeakerRollups(all, { q: "a", status: "incomplete" }).map((r) => r.speaker.id),
    ).toEqual(["grace", "alan"]);
  });
});
