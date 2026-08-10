import { describe, expect, it } from "vitest";
import { unassignedConfirmedSpeakerIds } from "./coverage";
import type { TaskSpeakerOption } from "./types";

function speaker(id: string, confirmed: boolean): TaskSpeakerOption {
  return { id, name: id, email: `${id}@example.com`, confirmed };
}

describe("unassignedConfirmedSpeakerIds", () => {
  it("returns the confirmed speakers who don't hold the task", () => {
    const speakers = [speaker("a", true), speaker("b", true), speaker("c", true)];
    expect(unassignedConfirmedSpeakerIds(speakers, ["b"])).toEqual(["a", "c"]);
  });

  it("ignores unconfirmed speakers, assigned or not", () => {
    const speakers = [speaker("a", true), speaker("b", false), speaker("c", false)];
    expect(unassignedConfirmedSpeakerIds(speakers, ["b"])).toEqual(["a"]);
  });

  it("doesn't let an unconfirmed speaker's assignment count as coverage", () => {
    // The old count subtraction (confirmed − assigned) read this as zero
    // missing and disabled the action while `a` still lacked the task.
    const speakers = [speaker("a", true), speaker("b", false)];
    expect(unassignedConfirmedSpeakerIds(speakers, ["b"])).toEqual(["a"]);
  });

  it("is empty once every confirmed speaker holds the task", () => {
    const speakers = [speaker("a", true), speaker("b", true)];
    expect(unassignedConfirmedSpeakerIds(speakers, ["a", "b", "stranger"])).toEqual([]);
  });

  it("treats no assignments as nobody covered", () => {
    const speakers = [speaker("a", true), speaker("b", true)];
    expect(unassignedConfirmedSpeakerIds(speakers, [])).toEqual(["a", "b"]);
  });

  it("is empty when nobody is confirmed", () => {
    expect(unassignedConfirmedSpeakerIds([speaker("a", false)], [])).toEqual([]);
  });
});
