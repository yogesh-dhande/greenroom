import { describe, expect, it } from "vitest";
import type { SubmissionStatus } from "@/db/entities";
import { speakerFacingStatus } from "@/domain/evaluation";

describe("speakerFacingStatus", () => {
  it("maps a waitlisted (maybe) submission to submitted (D-028: a speaker never sees 'maybe')", () => {
    expect(speakerFacingStatus("maybe")).toBe("submitted");
  });

  it("passes every other status through unchanged", () => {
    const statuses: SubmissionStatus[] = [
      "draft",
      "submitted",
      "approved",
      "denied",
      "withdrawn",
    ];
    for (const status of statuses) {
      expect(speakerFacingStatus(status)).toBe(status);
    }
  });
});
