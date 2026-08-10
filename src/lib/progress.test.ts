import { describe, expect, it } from "vitest";
import { completionPercent, completionSentence } from "./progress";

describe("completionPercent", () => {
  it("is the rounded share of the total", () => {
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(2, 3)).toBe(67);
    expect(completionPercent(3, 3)).toBe(100);
  });

  it("is 0 with nothing to be a share of", () => {
    expect(completionPercent(0, 0)).toBe(0);
    expect(completionPercent(2, 0)).toBe(0);
    expect(completionPercent(0, -1)).toBe(0);
  });

  it("clamps counts that fall outside the total", () => {
    expect(completionPercent(5, 3)).toBe(100);
    expect(completionPercent(-1, 3)).toBe(0);
  });
});

describe("completionSentence", () => {
  it("spells the fraction out for a screen reader", () => {
    expect(completionSentence(1, 3)).toBe("1 of 3 tasks complete");
  });

  it("agrees with a total of one", () => {
    expect(completionSentence(0, 1)).toBe("0 of 1 task complete");
    expect(completionSentence(1, 1)).toBe("1 of 1 task complete");
  });

  it("takes the surface's own noun and verb", () => {
    expect(completionSentence(1, 2, { noun: "submission", verb: "scored" })).toBe(
      "1 of 2 submissions scored",
    );
  });

  it("states an empty total in words rather than as a fraction", () => {
    expect(completionSentence(0, 0)).toBe("No tasks");
    expect(completionSentence(0, 0, { noun: "submission" })).toBe("No submissions");
  });
});
