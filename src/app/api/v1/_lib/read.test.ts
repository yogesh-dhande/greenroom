import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateApiRead: vi.fn(),
  getRepos: vi.fn(),
  suggestAdminSessionSlot: vi.fn(),
}));

vi.mock("@/lib/api-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-request")>()),
  authenticateApiRead: mocks.authenticateApiRead,
}));

vi.mock("@/lib/db", () => ({ getRepos: mocks.getRepos }));

vi.mock("@/domain/admin-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/admin-api")>()),
  suggestSessionSlot: mocks.suggestAdminSessionSlot,
}));

import { AdminWorkflowError } from "@/domain/admin-api";
import { suggestSessionSlot } from "./read";

describe("REST read loader parity", () => {
  const repos = {
    events: {
      getById: vi.fn().mockResolvedValue({
        id: "event-1",
        timezone: "America/Los_Angeles",
      }),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiRead.mockResolvedValue({
      credentialId: "key-1",
      ownerId: "admin-1",
      permission: "read",
      eventScope: "all",
      tokenType: "api_key",
    });
    mocks.getRepos.mockResolvedValue(repos);
  });

  it("delegates slot calculation to the shared admin workflow", async () => {
    const suggestion = {
      day: "2026-08-12",
      startTime: "09:00",
      endTime: "09:30",
      roomId: "room-1",
    };
    mocks.suggestAdminSessionSlot.mockResolvedValue(suggestion);
    const request = new Request(
      "https://greenroom.test/api/v1/events/event-1/sessions/session-1/suggested-slot",
    );

    await expect(suggestSessionSlot(request, "event-1", "session-1")).resolves.toEqual({
      suggestion,
      timezone: "America/Los_Angeles",
    });
    expect(mocks.authenticateApiRead).toHaveBeenCalledWith(request, "event-1");
    expect(mocks.suggestAdminSessionSlot).toHaveBeenCalledWith(
      { repos },
      "event-1",
      "session-1",
    );
  });

  it("maps the shared workflow's missing-session result to the REST 404 error", async () => {
    mocks.suggestAdminSessionSlot.mockRejectedValue(
      new AdminWorkflowError("not_found", "Session not found"),
    );

    await expect(
      suggestSessionSlot(
        new Request("https://greenroom.test/api/v1/events/event-1/sessions/missing/suggested-slot"),
        "event-1",
        "missing",
      ),
    ).rejects.toEqual(expect.objectContaining({
      status: 404,
      code: "not_found",
      message: "Session not found.",
    }));
  });
});
