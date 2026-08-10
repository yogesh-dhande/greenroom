import { describe, expect, it } from "vitest";
import type { TaskAssignment } from "@/db/entities";
import {
  planAssignToConfirmedSpeakers,
  planAssignToSpeakers,
  resolveAssigneeSpeakerIds,
} from "@/domain/task-assign";

const EPOCH = new Date(0);

function assignment(overrides: Partial<TaskAssignment> & { id: string }): TaskAssignment {
  return {
    taskId: "task-1",
    speakerId: "spk-1",
    status: "pending",
    completedAt: null,
    responseJson: null,
    fileUrl: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

describe("planAssignToConfirmedSpeakers", () => {
  it("assigns every confirmed speaker when the task has no assignments yet", () => {
    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: ["spk-1", "spk-2", "spk-3"],
      existingAssignments: [],
    });

    expect(plan.newAssignments.map((a) => a.speakerId).sort()).toEqual([
      "spk-1",
      "spk-2",
      "spk-3",
    ]);
    expect(plan.alreadyAssignedCount).toBe(0);
    for (const a of plan.newAssignments) {
      expect(a.taskId).toBe("task-1");
      expect(a.status).toBe("pending");
      expect(a.completedAt).toBeNull();
    }
  });

  it("skips speakers who already hold the task (idempotent re-run)", () => {
    const existing = [assignment({ id: "a1", taskId: "task-1", speakerId: "spk-1" })];

    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: ["spk-1", "spk-2"],
      existingAssignments: existing,
    });

    expect(plan.newAssignments.map((a) => a.speakerId)).toEqual(["spk-2"]);
    expect(plan.alreadyAssignedCount).toBe(1);
  });

  it("never reproduces or resets an existing assignment's completion state", () => {
    const existing = [
      assignment({
        id: "a1",
        taskId: "task-1",
        speakerId: "spk-1",
        status: "completed",
        completedAt: new Date("2026-01-01"),
        fileUrl: "https://example.com/slides.pdf",
      }),
    ];

    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: ["spk-1"],
      existingAssignments: existing,
    });

    // The completed speaker is entirely absent from the plan — nothing is
    // ever written back over their row, so a re-run can't touch it.
    expect(plan.newAssignments).toEqual([]);
    expect(plan.alreadyAssignedCount).toBe(1);
  });

  it("reports the zero-state when every confirmed speaker already has the task", () => {
    const existing = [
      assignment({ id: "a1", taskId: "task-1", speakerId: "spk-1" }),
      assignment({ id: "a2", taskId: "task-1", speakerId: "spk-2" }),
    ];

    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: ["spk-1", "spk-2"],
      existingAssignments: existing,
    });

    expect(plan.newAssignments).toEqual([]);
    expect(plan.alreadyAssignedCount).toBe(2);
  });

  it("ignores assignments that belong to a different task", () => {
    const existing = [assignment({ id: "a1", taskId: "task-OTHER", speakerId: "spk-1" })];

    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: ["spk-1"],
      existingAssignments: existing,
    });

    expect(plan.newAssignments.map((a) => a.speakerId)).toEqual(["spk-1"]);
    expect(plan.alreadyAssignedCount).toBe(0);
  });

  it("dedupes a confirmed-speaker list that names the same speaker twice", () => {
    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: ["spk-1", "spk-1"],
      existingAssignments: [],
    });

    expect(plan.newAssignments.map((a) => a.speakerId)).toEqual(["spk-1"]);
  });

  it("plans nothing when there are no confirmed speakers", () => {
    const plan = planAssignToConfirmedSpeakers({
      taskId: "task-1",
      confirmedSpeakerIds: [],
      existingAssignments: [],
    });

    expect(plan.newAssignments).toEqual([]);
    expect(plan.alreadyAssignedCount).toBe(0);
  });
});

/** Targeted assignment: a chosen subset, or one speaker from their record
 * page (decisions.md D-069). Same dedupe as the all-at-once action, which is
 * the point — these are the paths that must not duplicate or reset work. */
describe("planAssignToSpeakers", () => {
  it("plans only the subset it was given, never the rest of the roster", () => {
    const plan = planAssignToSpeakers({
      taskId: "task-1",
      speakerIds: ["spk-2"],
      existingAssignments: [],
    });

    expect(plan.newAssignments.map((a) => a.speakerId)).toEqual(["spk-2"]);
    expect(plan.newAssignments[0]).toMatchObject({
      taskId: "task-1",
      status: "pending",
      completedAt: null,
      fileUrl: null,
      responseJson: null,
    });
  });

  it("dedupes a subset that names the same speaker twice", () => {
    const plan = planAssignToSpeakers({
      taskId: "task-1",
      speakerIds: ["spk-2", "spk-2", "spk-3", "spk-2"],
      existingAssignments: [],
    });

    expect(plan.newAssignments.map((a) => a.speakerId)).toEqual(["spk-2", "spk-3"]);
    expect(plan.alreadyAssignedCount).toBe(0);
  });

  it("plans nothing for an empty subset", () => {
    const plan = planAssignToSpeakers({
      taskId: "task-1",
      speakerIds: [],
      existingAssignments: [assignment({ id: "a1", speakerId: "spk-1" })],
    });

    expect(plan.newAssignments).toEqual([]);
    expect(plan.alreadyAssignedCount).toBe(0);
  });

  it("is a no-op for a speaker who already holds the task, completion included", () => {
    const existing = [
      assignment({
        id: "a1",
        taskId: "task-1",
        speakerId: "spk-1",
        status: "completed",
        completedAt: new Date("2026-05-01"),
        fileUrl: "https://example.com/slides.pdf",
      }),
    ];

    const plan = planAssignToSpeakers({
      taskId: "task-1",
      speakerIds: ["spk-1"],
      existingAssignments: existing,
    });

    expect(plan.newAssignments).toEqual([]);
    expect(plan.alreadyAssignedCount).toBe(1);
    // Re-running against the plan's own result changes nothing either.
    expect(
      planAssignToSpeakers({
        taskId: "task-1",
        speakerIds: ["spk-1"],
        existingAssignments: existing,
      }).newAssignments,
    ).toEqual([]);
  });

  it("assigns the speakers who are missing and leaves the ones who aren't", () => {
    const plan = planAssignToSpeakers({
      taskId: "task-1",
      speakerIds: ["spk-1", "spk-2", "spk-3"],
      existingAssignments: [
        assignment({ id: "a1", speakerId: "spk-1" }),
        assignment({ id: "a2", speakerId: "spk-3", taskId: "task-OTHER" }),
      ],
    });

    expect(plan.newAssignments.map((a) => a.speakerId)).toEqual(["spk-2", "spk-3"]);
    expect(plan.alreadyAssignedCount).toBe(1);
  });
});

describe("resolveAssigneeSpeakerIds", () => {
  const rosterSpeakerIds = ["spk-1", "spk-2", "spk-3"];

  it("assigns nobody in all-confirmed mode — that path stays acceptance-driven", () => {
    expect(
      resolveAssigneeSpeakerIds({
        mode: "all_confirmed",
        selectedSpeakerIds: ["spk-1", "spk-2"],
        rosterSpeakerIds,
      }),
    ).toEqual([]);
  });

  it("keeps the selection, in roster order", () => {
    expect(
      resolveAssigneeSpeakerIds({
        mode: "selected",
        selectedSpeakerIds: ["spk-3", "spk-1"],
        rosterSpeakerIds,
      }),
    ).toEqual(["spk-1", "spk-3"]);
  });

  it("drops ids that aren't on this event's roster", () => {
    expect(
      resolveAssigneeSpeakerIds({
        mode: "selected",
        selectedSpeakerIds: ["spk-2", "someone-elses-user-id"],
        rosterSpeakerIds,
      }),
    ).toEqual(["spk-2"]);
  });

  it("dedupes a selection and an empty one resolves to nothing", () => {
    expect(
      resolveAssigneeSpeakerIds({
        mode: "selected",
        selectedSpeakerIds: ["spk-2", "spk-2"],
        rosterSpeakerIds,
      }),
    ).toEqual(["spk-2"]);
    expect(
      resolveAssigneeSpeakerIds({
        mode: "selected",
        selectedSpeakerIds: [],
        rosterSpeakerIds,
      }),
    ).toEqual([]);
  });
});
