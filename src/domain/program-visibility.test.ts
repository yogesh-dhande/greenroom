import { describe, expect, it } from "vitest";
import { eventSchema, newEventSchema } from "@/db/entities";
import { programVisible } from "@/domain/program-visibility";

describe("programVisible", () => {
  it("hides the program until it is published", () => {
    expect(programVisible({ programPublished: false })).toBe(false);
  });

  it("shows the program once it is published", () => {
    expect(programVisible({ programPublished: true })).toBe(true);
  });

  // The flag carries no zod default on purpose (src/db/entities.ts): a
  // default would survive `newEventSchema.partial()` and unpublish a live
  // program the next time an admin saved an unrelated event setting.
  it("cannot be left unstated on an event", () => {
    const row = {
      id: "evt_1",
      name: "AI Engineer Summit",
      slug: "ai-engineer-summit",
      description: null,
      startDate: null,
      endDate: null,
      timezone: "UTC",
      location: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(eventSchema.safeParse(row).success).toBe(false);
    expect(newEventSchema.partial().parse(row)).not.toHaveProperty("programPublished");
    expect(programVisible(eventSchema.parse({ ...row, programPublished: true }))).toBe(true);
  });
});
