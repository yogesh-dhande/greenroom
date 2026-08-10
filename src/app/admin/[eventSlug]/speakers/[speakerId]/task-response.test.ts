import { describe, expect, it } from "vitest";
import type { FormField } from "@/db/entities";
import { answerText } from "./task-response";

function field(type: FormField["type"], overrides: Partial<FormField> = {}): FormField {
  return { id: "f1", type, label: "Question", ...overrides };
}

describe("answerText", () => {
  it("drops blank answers so they don't render as empty rows", () => {
    expect(answerText(field("text"), undefined)).toBeNull();
    expect(answerText(field("text"), null)).toBeNull();
    expect(answerText(field("text"), "")).toBeNull();
    expect(answerText(field("multiselect"), [])).toBeNull();
  });

  it("renders text and numbers as given", () => {
    expect(answerText(field("textarea"), "Arriving Tuesday")).toBe("Arriving Tuesday");
    expect(answerText(field("text"), 3)).toBe("3");
  });

  it("renders a checkbox as Yes/No rather than a raw boolean", () => {
    expect(answerText(field("checkbox"), true)).toBe("Yes");
    expect(answerText(field("checkbox"), false)).toBe("No");
  });

  it("joins multi-select choices into one line", () => {
    expect(answerText(field("multiselect"), ["Vegetarian", "Nut allergy"])).toBe(
      "Vegetarian, Nut allergy",
    );
  });

  it("shows a file field as its filename, without the uniqueness prefix", () => {
    expect(answerText(field("file"), "uploads/tasks/0a1b2c3d-passport.pdf")).toBe("passport.pdf");
  });

  it("summarizes co-speaker rows one per line and skips blank ones", () => {
    const value = [
      { name: "Ada", email: "ada@example.com", title: "CTO", company: "Analytical" },
      { name: "", email: "" },
    ];
    expect(answerText(field("co_speakers"), value)).toBe(
      "Ada — ada@example.com — CTO, Analytical",
    );
  });

  it("refuses to print an object as [object Object]", () => {
    // A form edited after the answers were filed can leave a value that no
    // longer matches its field's type.
    expect(answerText(field("text"), { nested: true })).toBeNull();
  });

  it("has no answer for a file field holding something other than a key", () => {
    expect(answerText(field("file"), 42)).toBeNull();
  });
});
