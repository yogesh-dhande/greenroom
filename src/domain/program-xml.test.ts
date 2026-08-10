import { describe, expect, it } from "vitest";
import { buildProgramXml } from "./program-xml";

describe("buildProgramXml", () => {
  it("serializes a feed and escapes user-authored text", () => {
    const result = buildProgramXml({
      event: { name: "A & B", timezone: "America/Los_Angeles" },
      programPublished: true,
      sessions: [
        {
          title: "Shipping < safely",
          description: null,
          day: "2026-08-10",
          startTime: "09:00",
          endTime: "09:30",
          roomName: "Main",
          trackName: "AI",
          speakerNames: ["Ada"],
          speakers: [{ name: "Ada", title: null, company: null }],
        },
      ],
      speakers: [{ name: "Ada", title: null, company: null, bio: null, headshotUrl: null }],
    });
    expect(result).toContain("<name>A &amp; B</name>");
    expect(result).toContain("<title>Shipping &lt; safely</title>");
    expect(result).toContain("<programPublished>true</programPublished>");
  });
});
