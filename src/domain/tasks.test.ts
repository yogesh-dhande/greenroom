import { describe, expect, it } from "vitest";
import type { Task } from "@/db/entities";
import { findDuplicateTask } from "@/domain/tasks";

const NOW = new Date("2026-05-01T17:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    eventId: "event-1",
    title: "Upload your slides",
    instructions: null,
    type: "file_request",
    formId: null,
    dueAt: new Date("2026-06-01T16:00:00.000Z"),
    autoAssignOnAccept: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("findDuplicateTask", () => {
  it("matches event, title, type, and due instant", () => {
    const existing = task();
    expect(
      findDuplicateTask([existing], {
        eventId: "event-1",
        title: "Upload your slides",
        type: "file_request",
        dueAt: new Date("2026-06-01T16:00:00.000Z"),
      }),
    ).toBe(existing);
  });

  it.each([
    { patch: { eventId: "event-2" }, description: "another event" },
    { patch: { title: "Upload your final slides" }, description: "another title" },
    { patch: { type: "confirm" as const }, description: "another type" },
    {
      patch: { dueAt: new Date("2026-06-02T16:00:00.000Z") },
      description: "another due date",
    },
  ])("allows a task with $description", ({ patch }) => {
    expect(
      findDuplicateTask([task()], {
        eventId: "event-1",
        title: "Upload your slides",
        type: "file_request",
        dueAt: new Date("2026-06-01T16:00:00.000Z"),
        ...patch,
      }),
    ).toBeNull();
  });

  it("treats two tasks without due dates as the same due-date identity", () => {
    const existing = task({ dueAt: null });
    expect(
      findDuplicateTask([existing], {
        eventId: "event-1",
        title: existing.title,
        type: existing.type,
        dueAt: null,
      }),
    ).toBe(existing);
  });
});
