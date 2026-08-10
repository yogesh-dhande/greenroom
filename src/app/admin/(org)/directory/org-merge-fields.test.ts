import { describe, expect, it } from "vitest";
import { ORG_MERGE_FIELDS, orgPortalUrl, orgSpeakerFields } from "./org-merge-fields";

// The rules asserted here are deliberately the same ones `speakerFields` and
// `portalUrl` apply in src/domain/comms.ts. Those are module-private, so this
// pins the behaviour rather than the call — if the event composer's greeting
// rule changes, this file is where the divergence shows up.

describe("ORG_MERGE_FIELDS", () => {
  it("promises nothing event-shaped", () => {
    // An org-level send has no event, and `checkTemplateDraft` blocks on a
    // field that isn't available — which is the honest answer here.
    for (const field of ["eventName", "eventDates", "eventLocation", "eventTimezone", "eventUrl"]) {
      expect(ORG_MERGE_FIELDS).not.toContain(field);
    }
    expect(ORG_MERGE_FIELDS).not.toContain("outstandingTasks");
  });

  it("offers the recipient, the organizer, and the portal", () => {
    expect(ORG_MERGE_FIELDS).toEqual([
      "speakerName",
      "speakerFirstName",
      "organizerName",
      "organizerEmail",
      "portalUrl",
    ]);
  });
});

describe("orgSpeakerFields", () => {
  it("matches the event composer's rule for a named contact", () => {
    const contact = { name: "Ada Lovelace", email: "ada@example.com" };
    expect(orgSpeakerFields(contact)).toEqual({
      speakerName: "Ada Lovelace",
      speakerFirstName: "Ada",
    });
  });

  it("falls back to the address and a neutral greeting when unnamed", () => {
    const contact = { name: null, email: "unknown@example.com" };
    expect(orgSpeakerFields(contact)).toEqual({
      speakerName: "unknown@example.com",
      speakerFirstName: "there",
    });
  });

  it("treats a whitespace-only name as no name", () => {
    expect(orgSpeakerFields({ name: "   ", email: "blank@example.com" })).toEqual({
      speakerName: "blank@example.com",
      speakerFirstName: "there",
    });
  });
});

describe("orgPortalUrl", () => {
  it("appends /portal without doubling the slash", () => {
    expect(orgPortalUrl("https://greenroom.example.com")).toBe(
      "https://greenroom.example.com/portal",
    );
    expect(orgPortalUrl("https://greenroom.example.com/")).toBe(
      "https://greenroom.example.com/portal",
    );
    expect(orgPortalUrl("https://greenroom.example.com///")).toBe(
      "https://greenroom.example.com/portal",
    );
  });

  it("points at the app-level portal, which is why it survives having no event", () => {
    expect(orgPortalUrl("http://localhost:3000")).toBe("http://localhost:3000/portal");
  });
});
