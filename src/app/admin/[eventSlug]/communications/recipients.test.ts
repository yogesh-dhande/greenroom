import { describe, expect, it } from "vitest";
import { eventRecipientIds } from "./recipients";

const empty = {
  sessionSpeakerIds: [],
  submissionSpeakerIds: [],
  assignedSpeakerIds: [],
  rosterSpeakerIds: [],
};

describe("eventRecipientIds", () => {
  it("includes a speaker who only exists on the roster", () => {
    // The manual-add and CSV-import path (decisions.md D-051) writes nothing
    // but an `event_speakers` row — leaving it out dropped those speakers
    // from the composer entirely.
    expect(eventRecipientIds({ ...empty, rosterSpeakerIds: ["user-1"] })).toEqual(
      new Set(["user-1"]),
    );
  });

  it("includes speakers reached through sessions, submissions and tasks", () => {
    const ids = eventRecipientIds({
      sessionSpeakerIds: ["on-session"],
      submissionSpeakerIds: ["co-speaker"],
      assignedSpeakerIds: ["has-tasks"],
      rosterSpeakerIds: ["on-roster"],
    });
    expect(ids).toEqual(new Set(["on-session", "co-speaker", "has-tasks", "on-roster"]));
  });

  it("counts a person reached twice only once", () => {
    const ids = eventRecipientIds({
      ...empty,
      sessionSpeakerIds: ["user-1"],
      rosterSpeakerIds: ["user-1"],
    });
    expect([...ids]).toEqual(["user-1"]);
  });

  it("leaves out anyone who isn't a speaker at all", () => {
    // A reviewer belongs in the log (D-050 nudges are sent to them) but must
    // never be selectable as a recipient, or "All speakers" would mail them.
    const ids = eventRecipientIds({ ...empty, sessionSpeakerIds: ["speaker-1"] });
    expect(ids.has("reviewer-1")).toBe(false);
  });
});
