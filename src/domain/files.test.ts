import { describe, expect, it } from "vitest";
import type { FileComment, FileVersion, Form, Task, TaskAssignment } from "@/db/entities";
import type { AssignmentView } from "@/domain/onboarding";
import {
  buildCommentThread,
  buildFileHistory,
  collectDeliverables,
  inferUploadKind,
  sortVersionsNewestFirst,
} from "@/domain/files";

const EPOCH = new Date(0);

function assignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: "asg-1",
    taskId: "task-1",
    speakerId: "spk-1",
    status: "completed",
    completedAt: new Date("2026-05-01T10:00:00Z"),
    responseJson: null,
    fileUrl: null,
    createdAt: EPOCH,
    updatedAt: new Date("2026-05-01T10:00:00Z"),
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    eventId: "evt-1",
    title: "Slides",
    instructions: null,
    type: "file_request",
    formId: null,
    dueAt: null,
    autoAssignOnAccept: true,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

function version(overrides: Partial<FileVersion> & { id: string }): FileVersion {
  return {
    assignmentId: "asg-1",
    fileKey: "uploads/task-1/abcd1234-deck.pdf",
    url: "/files/uploads/task-1/abcd1234-deck.pdf",
    filename: "deck.pdf",
    uploadedBy: "spk-1",
    createdAt: EPOCH,
    ...overrides,
  };
}

function view(overrides: { assignment?: TaskAssignment; task?: Task } = {}): AssignmentView {
  return {
    assignment: overrides.assignment ?? assignment(),
    task: overrides.task ?? task(),
    state: "complete",
  };
}

describe("sortVersionsNewestFirst", () => {
  it("orders by upload time, newest first", () => {
    const ordered = sortVersionsNewestFirst([
      version({ id: "v2", createdAt: new Date("2026-05-02T00:00:00Z") }),
      version({ id: "v1", createdAt: new Date("2026-05-01T00:00:00Z") }),
      version({ id: "v3", createdAt: new Date("2026-05-03T00:00:00Z") }),
    ]);
    expect(ordered.map((v) => v.id)).toEqual(["v3", "v2", "v1"]);
  });

  it("breaks same-second ties deterministically", () => {
    const same = new Date("2026-05-01T00:00:00Z");
    const first = sortVersionsNewestFirst([
      version({ id: "va", createdAt: same }),
      version({ id: "vb", createdAt: same }),
    ]);
    const second = sortVersionsNewestFirst([
      version({ id: "vb", createdAt: same }),
      version({ id: "va", createdAt: same }),
    ]);
    expect(first.map((v) => v.id)).toEqual(second.map((v) => v.id));
  });

  it("leaves the input untouched", () => {
    const input = [
      version({ id: "v1", createdAt: new Date("2026-05-01T00:00:00Z") }),
      version({ id: "v2", createdAt: new Date("2026-05-02T00:00:00Z") }),
    ];
    sortVersionsNewestFirst(input);
    expect(input.map((v) => v.id)).toEqual(["v1", "v2"]);
  });
});

describe("buildFileHistory", () => {
  it("reports nothing uploaded for an assignment with no file and no versions", () => {
    expect(buildFileHistory(assignment(), [])).toEqual({
      current: null,
      older: [],
      versionCount: 0,
    });
  });

  it("treats a pre-versions upload as version 1", () => {
    const history = buildFileHistory(
      assignment({ fileUrl: "/files/uploads/task-1/abcd1234-deck.pdf" }),
      [],
    );
    expect(history.versionCount).toBe(1);
    expect(history.older).toEqual([]);
    expect(history.current).toMatchObject({
      key: "uploads/task-1/abcd1234-deck.pdf",
      filename: "deck.pdf",
      uploadedAt: new Date("2026-05-01T10:00:00Z"),
    });
  });

  it("names a file stored as an absolute URL from its last segment", () => {
    const history = buildFileHistory(
      assignment({ fileUrl: "https://files.example.com/imported/deck-v2.pdf" }),
      [],
    );
    expect(history.current).toMatchObject({ key: null, filename: "deck-v2.pdf" });
  });

  it("makes the newest version current and lists the rest as older", () => {
    const history = buildFileHistory(assignment({ fileUrl: "/files/uploads/task-1/c-final.pdf" }), [
      version({ id: "v1", filename: "draft.pdf", createdAt: new Date("2026-05-01T00:00:00Z") }),
      version({ id: "v3", filename: "final.pdf", createdAt: new Date("2026-05-03T00:00:00Z") }),
      version({ id: "v2", filename: "revised.pdf", createdAt: new Date("2026-05-02T00:00:00Z") }),
    ]);
    expect(history.versionCount).toBe(3);
    expect(history.current?.filename).toBe("final.pdf");
    expect(history.older.map((v) => v.filename)).toEqual(["revised.pdf", "draft.pdf"]);
  });
});

describe("collectDeliverables", () => {
  const headshotForm: Form = {
    id: "form-1",
    eventId: "evt-1",
    name: "Bio & photos",
    slug: "bio-photos",
    type: "abstract",
    welcomeCopy: null,
    fields: [
      { id: "headshot", type: "file", label: "Headshot" },
      { id: "bio", type: "textarea", label: "Bio" },
    ],
    opensAt: null,
    closesAt: null,
    confirmationPageContent: null,
    confirmationEmailSubject: null,
    confirmationEmailBody: null,
    maxSubmissionsPerSpeaker: null,
    isPublished: true,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };

  it("collects both an assignment's own upload and a form answer's file", () => {
    const deliverables = collectDeliverables({
      views: [
        view({
          assignment: assignment({
            id: "asg-file",
            fileUrl: "/files/uploads/task-1/abcd1234-deck.pdf",
          }),
        }),
        view({
          assignment: assignment({
            id: "asg-form",
            taskId: "task-2",
            responseJson: { headshot: "uploads/task-2/beef5678-priya.jpg", bio: "Hello" },
            completedAt: new Date("2026-05-02T10:00:00Z"),
          }),
          task: task({ id: "task-2", title: "Bio & photos", type: "form", formId: "form-1" }),
        }),
      ],
      formsById: new Map([["form-1", headshotForm]]),
      versionsByAssignment: new Map(),
    });

    // Newest first: the form answer landed a day after the deck.
    expect(deliverables.map((d) => d.label)).toEqual(["Bio & photos — Headshot", "Slides"]);
    expect(deliverables[0]).toMatchObject({
      assignmentId: "asg-form",
      fromFormAnswer: true,
      versionCount: 1,
    });
    expect(deliverables[0].current.filename).toBe("priya.jpg");
    expect(deliverables[1]).toMatchObject({ assignmentId: "asg-file", fromFormAnswer: false });
  });

  it("counts versions and hides superseded uploads behind the current one", () => {
    const [deck] = collectDeliverables({
      views: [
        view({
          assignment: assignment({ fileUrl: "/files/uploads/task-1/cccc3333-final.pdf" }),
        }),
      ],
      formsById: new Map(),
      versionsByAssignment: new Map([
        [
          "asg-1",
          [
            version({ id: "v1", filename: "draft.pdf", createdAt: new Date("2026-05-01T00:00:00Z") }),
            version({ id: "v2", filename: "final.pdf", createdAt: new Date("2026-05-04T00:00:00Z") }),
          ],
        ],
      ]),
    });

    expect(deck.versionCount).toBe(2);
    expect(deck.current.filename).toBe("final.pdf");
    expect(deck.older.map((v) => v.filename)).toEqual(["draft.pdf"]);
  });

  it("skips assignments with nothing uploaded and empty form answers", () => {
    const deliverables = collectDeliverables({
      views: [
        view(),
        view({
          assignment: assignment({ id: "asg-form", responseJson: { headshot: "" } }),
          task: task({ id: "task-2", type: "form", formId: "form-1" }),
        }),
      ],
      formsById: new Map([["form-1", headshotForm]]),
      versionsByAssignment: new Map(),
    });
    expect(deliverables).toEqual([]);
  });
});

describe("buildCommentThread", () => {
  function comment(overrides: Partial<FileComment> & { id: string }): FileComment {
    return {
      assignmentId: "asg-1",
      authorId: "spk-1",
      body: "Here it is.",
      createdAt: EPOCH,
      ...overrides,
    };
  }

  it("reads oldest first, with author names resolved", () => {
    const thread = buildCommentThread(
      [
        comment({ id: "c2", authorId: "adm-1", body: "Can you re-export it?", createdAt: new Date("2026-05-02T00:00:00Z") }),
        comment({ id: "c1", body: "Deck attached.", createdAt: new Date("2026-05-01T00:00:00Z") }),
      ],
      new Map([
        ["spk-1", { name: "Priya Raman", email: "priya@example.com" }],
        ["adm-1", { name: null, email: "admin@greenroom.dev" }],
      ]),
    );

    expect(thread.map((c) => [c.authorName, c.body])).toEqual([
      ["Priya Raman", "Deck attached."],
      ["admin@greenroom.dev", "Can you re-export it?"],
    ]);
  });

  it("keeps a comment whose author can't be resolved", () => {
    const thread = buildCommentThread([comment({ id: "c1", authorId: "gone" })], new Map());
    expect(thread[0].authorName).toBe("Unknown");
  });
});

describe("inferUploadKind", () => {
  it("reads a picture request off the task's own wording", () => {
    expect(inferUploadKind({ title: "Finalize bio & photos", instructions: null })).toBe("image");
    expect(
      inferUploadKind({ title: "Speaker photo", instructions: "A square headshot, please." }),
    ).toBe("image");
  });

  it("reads a slide request, even when it names PDF as the format", () => {
    expect(inferUploadKind({ title: "Upload slides", instructions: "Export your deck as a PDF." })).toBe(
      "slides",
    );
  });

  it("reads a paperwork request", () => {
    expect(inferUploadKind({ title: "Signed speaker agreement", instructions: null })).toBe(
      "document",
    );
  });

  it("stays open when the task asks for more than one kind, or names none", () => {
    expect(inferUploadKind({ title: "Slides and headshot", instructions: null })).toBe("any");
    expect(inferUploadKind({ title: "Send us your materials", instructions: null })).toBe("any");
  });
});
