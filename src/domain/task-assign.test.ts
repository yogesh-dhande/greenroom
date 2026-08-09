import { describe, expect, it } from "vitest";
import type { TaskAssignment } from "@/db/entities";
import { planAssignToConfirmedSpeakers } from "@/domain/task-assign";

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
